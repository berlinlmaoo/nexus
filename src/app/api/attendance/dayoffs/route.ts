export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import {
  attendanceMonthRange,
  enumerateAttendanceDates,
  formatAttendanceDateKey,
  getAttendanceWorkspaceContext,
  getPrimaryAttendanceTeam,
  parseDateOnlyToUtc,
  serializeAttendanceRequest,
} from "@/lib/attendance"

const DEFAULT_DAYOFF_QUOTA = 4 // workspace default; overridable per-person via PATCH
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

// BoD-only per-user day-off management for the Control Room → Members tab.
//   GET    ?userId=&month=YYYY-MM  -> list that user's day-offs for the month + usage
//   POST   { userId, date, reason? } -> grant an APPROVED day-off (no quota cap)
//   DELETE ?id=                     -> remove a day-off request

async function gate(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const ctx = await getAttendanceWorkspaceContext(session.user.id)
  if (!ctx.workspace) return { error: NextResponse.json({ error: "No workspace membership found" }, { status: 404 }) }
  if (!ctx.canManageAttendance) return { error: NextResponse.json({ error: "Hanya BoD ke atas yang bisa atur day-off." }, { status: 403 }) }
  return { session, workspaceId: ctx.workspace.id }
}

export async function GET(req: NextRequest) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const { workspaceId } = g

    const userId = (req.nextUrl.searchParams.get("userId") ?? "").trim()
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })
    const month = (req.nextUrl.searchParams.get("month") ?? "").trim() || formatAttendanceDateKey().slice(0, 7)
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Bulan harus format YYYY-MM." }, { status: 400 })
    const { start, end } = attendanceMonthRange(month)

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { dayOffQuota: true },
    })
    const quota = member?.dayOffQuota ?? DEFAULT_DAYOFF_QUOTA

    // Overlap window (matches the quota counting in the requests route): any day-off whose range
    // intersects the month, even if it starts in the previous month.
    const dayoffs = await prisma.attendanceRequest.findMany({
      where: {
        workspaceId,
        userId,
        type: "DAY_OFF",
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: { startDate: "asc" },
    })

    // "used" = day-off DAYS within the month (clip each row to [start, end]) — matches the 4/month cap.
    const used = dayoffs.reduce((sum, d) => {
      const clipStart = d.startDate.getTime() < start.getTime() ? start : d.startDate
      const clipEnd = d.endDate.getTime() > end.getTime() ? end : d.endDate
      return sum + enumerateAttendanceDates(clipStart, clipEnd).length
    }, 0)

    return NextResponse.json({
      month,
      quota,
      quotaOverride: member?.dayOffQuota ?? null,
      defaultQuota: DEFAULT_DAYOFF_QUOTA,
      used,
      dayoffs: dayoffs.map(serializeAttendanceRequest),
    })
  } catch (error) {
    console.error("Error listing day-offs:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Set (or reset) a member's monthly day-off quota override.
//   PATCH { userId, quota }  -> quota = integer 0..366, or null/"" to reset to the default (4)
export async function PATCH(req: NextRequest) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const { session, workspaceId } = g

    const body = await req.json().catch(() => ({}))
    const userId = String(body?.userId ?? "").trim()
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

    let quota: number | null
    if (body?.quota === null || body?.quota === undefined || body?.quota === "") {
      quota = null // reset to default
    } else {
      const n = Number(body.quota)
      if (!Number.isInteger(n) || n < 0 || n > 366) {
        return NextResponse.json({ error: "Jatah day-off harus angka bulat 0–366." }, { status: 400 })
      }
      quota = n
    }

    const target = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true },
    })
    if (!target) return NextResponse.json({ error: "User bukan member workspace ini." }, { status: 404 })

    await prisma.workspaceMember.update({ where: { id: target.id }, data: { dayOffQuota: quota } })

    try {
      await logAudit({
        action: "update",
        entityType: "workspace_member",
        entityId: target.id,
        entityName: `dayoff-quota:${userId}`,
        userId: session.user.id,
        request: req,
        metadata: { reason: "admin_dayoff_quota", quota },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({ quota: quota ?? DEFAULT_DAYOFF_QUOTA, quotaOverride: quota })
  } catch (error) {
    console.error("Error setting day-off quota:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const { session, workspaceId } = g

    const body = await req.json().catch(() => ({}))
    const userId = String(body?.userId ?? "").trim()
    const date = String(body?.date ?? "").trim()
    const reason = String(body?.reason ?? "").trim()
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })
    if (!DATE_RE.test(date)) return NextResponse.json({ error: "Tanggal harus format YYYY-MM-DD." }, { status: 400 })

    // Target must be a member of this workspace.
    const target = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true },
    })
    if (!target) return NextResponse.json({ error: "User bukan member workspace ini." }, { status: 404 })

    const day = parseDateOnlyToUtc(date)

    // Idempotent: skip if a day-off already covers that date.
    const existing = await prisma.attendanceRequest.findFirst({
      where: {
        workspaceId, userId, type: "DAY_OFF",
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: day }, endDate: { gte: day },
      },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ error: "Sudah ada day-off di tanggal itu." }, { status: 409 })

    const primary = await getPrimaryAttendanceTeam(userId, workspaceId)
    const created = await prisma.attendanceRequest.create({
      data: {
        userId,
        workspaceId,
        teamId: primary?.teamId ?? null,
        type: "DAY_OFF",
        status: "APPROVED",
        startDate: day,
        endDate: day,
        reason: reason || "Day-off diatur oleh BoD (Control Room)",
        reviewNote: "Diatur via Control Room",
        approvalSource: "ADMIN",
        reviewedAt: new Date(),
        reviewedById: session.user.id,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    })

    try {
      await logAudit({
        action: "create",
        entityType: "attendance_request",
        entityId: created.id,
        entityName: `dayoff:${created.user?.name ?? userId}`,
        userId: session.user.id,
        request: req,
        metadata: { reason: "admin_dayoff_grant", date },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({ dayoff: serializeAttendanceRequest(created) }, { status: 201 })
  } catch (error) {
    console.error("Error granting day-off:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const { session, workspaceId } = g

    const id = (req.nextUrl.searchParams.get("id") ?? "").trim()
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const target = await prisma.attendanceRequest.findUnique({ where: { id }, select: { id: true, workspaceId: true, type: true, userId: true } })
    if (!target || target.workspaceId !== workspaceId || target.type !== "DAY_OFF") {
      return NextResponse.json({ error: "Day-off tidak ditemukan." }, { status: 404 })
    }

    await prisma.attendanceRequest.delete({ where: { id } })

    try {
      await logAudit({
        action: "delete",
        entityType: "attendance_request",
        entityId: id,
        entityName: `dayoff:${target.userId}`,
        userId: session.user.id,
        request: req,
        metadata: { reason: "admin_dayoff_delete" },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({ message: "Day-off dihapus." })
  } catch (error) {
    console.error("Error deleting day-off:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
