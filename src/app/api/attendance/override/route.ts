export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import {
  getAttendanceWorkspaceContext,
  getPrimaryAttendanceTeam,
  parseDateOnlyToUtc,
  resolveEffectiveAttendanceShift,
  resolveShiftWindowAt,
  formatAttendanceDateKey,
  getAttendanceDate,
} from "@/lib/attendance"
import { cancelAttendancePenaltiesForDate, isAutoDeduction, grantAttendanceWaiver } from "@/lib/attendance-absence"

type OverrideAction = "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "CLEAR_PENALTY"
const ACTIONS = new Set<OverrideAction>(["PRESENT", "LEAVE", "SICK", "DAY_OFF", "CLEAR_PENALTY"])

// BoD status override from the crew streak board: rewrite one member-day to Hadir (on-time) /
// Cuti / Sakit / Day off — refunding every attendance XP penalty + restoring an auto-cut day-off
// for that day — or just CLEAR_PENALTY (remove the punishment, change nothing else).
// All actions are idempotent and audit-logged.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace?.id || !context.canManageAttendance) {
      return NextResponse.json({ error: "Forbidden — khusus BoD." }, { status: 403 })
    }
    const workspaceId = context.workspace.id

    type Body = { userId?: string; date?: string; action?: string; note?: string; checkInAt?: string; checkOutAt?: string | null }
    let body: Body | null = null
    try {
      body = (await req.json()) as Body
    } catch {
      // no body
    }
    const targetUserId = (body?.userId ?? "").trim()
    const action = (body?.action ?? "").toUpperCase() as OverrideAction
    if (!targetUserId || !body?.date || !ACTIONS.has(action)) {
      return NextResponse.json({ error: "userId, date (YYYY-MM-DD), dan action (PRESENT|LEAVE|SICK|DAY_OFF|CLEAR_PENALTY) wajib diisi." }, { status: 400 })
    }

    const date = parseDateOnlyToUtc(body.date)
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Format tanggal tidak valid (YYYY-MM-DD)." }, { status: 400 })
    }
    if (date.getTime() > getAttendanceDate().getTime()) {
      return NextResponse.json({ error: "Tidak bisa mengubah status tanggal di masa depan." }, { status: 400 })
    }
    const dateKey = formatAttendanceDateKey(date)

    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      select: { userId: true },
    })
    if (!membership) {
      return NextResponse.json({ error: "User bukan anggota workspace ini." }, { status: 404 })
    }

    // Every action wipes the day's penalties: refunds late/no-checkout/alpha XP and removes the
    // cron's auto-deducted day-off (quota restored).
    const refunded = await cancelAttendancePenaltiesForDate(targetUserId, workspaceId, date, dateKey)

    if (action === "CLEAR_PENALTY") {
      // Without a waiver the refund would NOT stick: the nightly cron re-derives penalties for every
      // day in its window and would re-cut the XP/day-off. The waiver makes the pardon permanent
      // (crons + check-in all skip penalty work for a waived member-day) without touching the status.
      await grantAttendanceWaiver(targetUserId, dateKey)
      await logOverride(req, session.user.id, workspaceId, targetUserId, dateKey, action, { refunded })
      return NextResponse.json({ ok: true, action, date: dateKey, refunded })
    }

    if (action === "PRESENT") {
      // Mark the day as hadir ON-TIME. The record's times are aligned to the member's shift so the
      // nightly cron (which recomputes lateness from checkInAt) can never re-apply a late penalty.
      const office = await prisma.officeLocation.findFirst({ where: { workspaceId, isActive: true } })
      if (!office) return NextResponse.json({ error: "Workspace belum punya office aktif." }, { status: 400 })
      const shift = await resolveEffectiveAttendanceShift({ userId: targetUserId, workspaceId, office, date })
      const { shiftStartAt, shiftEndAt } = resolveShiftWindowAt(date, office, shift)

      // Optional custom times: an admin filling a MISSING record from the correction drawer (e.g. staff
      // who couldn't check in during an outage) passes the exact times. Omitted → the on-time shift window
      // (the board's "Hadir" button). Always marked ON_TIME + correctedAt so the nightly cron never
      // re-applies a penalty for an admin-filled day.
      const customIn = typeof body.checkInAt === "string" && body.checkInAt.trim() ? new Date(body.checkInAt) : null
      if (customIn && Number.isNaN(customIn.getTime())) return NextResponse.json({ error: "Jam check-in tidak valid." }, { status: 400 })
      const checkInAt = customIn ?? shiftStartAt
      // checkOutAt key present → honor it (a time, or null for "check-in only"); absent → default shift end.
      const hasOutKey = Object.prototype.hasOwnProperty.call(body, "checkOutAt")
      let checkOutAt: Date | null = shiftEndAt
      if (hasOutKey) {
        checkOutAt = body.checkOutAt && String(body.checkOutAt).trim() ? new Date(body.checkOutAt as string) : null
        if (checkOutAt && Number.isNaN(checkOutAt.getTime())) return NextResponse.json({ error: "Jam check-out tidak valid." }, { status: 400 })
      }
      if (checkOutAt && checkOutAt.getTime() < checkInAt.getTime()) return NextResponse.json({ error: "Check-out tidak boleh sebelum check-in." }, { status: 400 })

      const correction = {
        checkInAt,
        checkOutAt,
        checkInStatus: "ON_TIME" as const,
        checkOutStatus: (checkOutAt ? "ON_TIME" : null) as "ON_TIME" | null,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: checkOutAt ? Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000)) : 0,
        status: (checkOutAt ? "COMPLETED" : "CHECKED_IN") as "COMPLETED" | "CHECKED_IN",
        checkOutApproval: null,
        effectiveShiftSource: shift.source,
        effectiveTeamId: shift.teamId,
        effectiveTeamName: shift.teamName,
        effectiveShiftStartTime: shift.shiftStartTime,
        effectiveShiftEndTime: shift.shiftEndTime,
        correctedAt: new Date(),
        correctedById: session.user.id,
        correctionReason: (body.note ?? "").trim() || "Diisi manual oleh BoD (staff gagal absen — sistem error).",
      }

      await prisma.attendanceRecord.upsert({
        where: { userId_workspaceId_attendanceDate: { userId: targetUserId, workspaceId, attendanceDate: date } },
        update: correction,
        create: {
          userId: targetUserId,
          workspaceId,
          attendanceDate: date,
          officeLocationId: office.id,
          ...correction,
        },
      })

      // The day is now PRESENT — a leftover covering request would hide it in the report. Cancel any
      // PENDING/APPROVED request covering ONLY this single day (multi-day requests are left alone and
      // reported back so the BoD can handle them deliberately).
      const covering = await prisma.attendanceRequest.findMany({
        where: { userId: targetUserId, workspaceId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: date }, endDate: { gte: date } },
        select: { id: true, type: true, startDate: true, endDate: true, reason: true, reviewedById: true, approvalSource: true },
      })
      const singleDay = covering.filter((r) => r.startDate.getTime() === r.endDate.getTime())
      const multiDay = covering.length - singleDay.length
      if (singleDay.length > 0) {
        await prisma.attendanceRequest.updateMany({
          where: { id: { in: singleDay.map((r) => r.id) } },
          data: { status: "REJECTED", reviewNote: "Dibatalkan: hari ini diubah jadi Hadir oleh BoD.", reviewedAt: new Date(), reviewedById: session.user.id, approvalSource: "ADMIN" },
        })
      }

      await logOverride(req, session.user.id, workspaceId, targetUserId, dateKey, action, { refunded, canceledRequests: singleDay.length })
      return NextResponse.json({ ok: true, action, date: dateKey, refunded, canceledRequests: singleDay.length, multiDayRequestsLeft: multiDay })
    }

    // LEAVE / SICK / DAY_OFF → an APPROVED covering request for that single day. The crons treat a
    // reviewer-stamped request as a real covering → skip + keep penalties refunded.
    const covering = await prisma.attendanceRequest.findMany({
      where: { userId: targetUserId, workspaceId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true, type: true, status: true, startDate: true, endDate: true, reason: true, reviewedById: true, approvalSource: true },
    })
    const real = covering.filter((r) => !isAutoDeduction(r))
    // A different-type request covering this day: cancel it if single-day (we're replacing the status);
    // refuse on multi-day so a week's leave isn't silently mangled from a one-day board click. Checked
    // FIRST so a refusal makes no changes.
    const conflicting = real.filter((r) => r.type !== action || r.status !== "APPROVED")
    const multiDayConflict = conflicting.find((r) => r.startDate.getTime() !== r.endDate.getTime())
    if (multiDayConflict) {
      return NextResponse.json(
        { error: `Tanggal ini bagian dari request ${multiDayConflict.type} multi-hari — atur request itu dulu di bagian Requests.` },
        { status: 409 },
      )
    }

    // Close any OPEN (no check-out) attendance record for this day. A leave/day-off must not leave a
    // dangling "pending check-out" — the staff can't check out (the day is now covered by the request)
    // AND the open record blocks their next day's check-in. Runs even when the day is ALREADY this status
    // (the common case: BoD changed the status mid-shift, and we're now cleaning up the stuck record).
    const closed = await prisma.attendanceRecord.deleteMany({
      where: { userId: targetUserId, workspaceId, attendanceDate: date, checkOutAt: null },
    })

    const sameTypeApproved = real.find((r) => r.type === action && r.status === "APPROVED")
    if (sameTypeApproved) {
      await logOverride(req, session.user.id, workspaceId, targetUserId, dateKey, action, { refunded, alreadyCovered: true, closedAttendance: closed.count })
      return NextResponse.json({ ok: true, action, date: dateKey, refunded, alreadyCovered: true, closedAttendance: closed.count })
    }

    if (conflicting.length > 0) {
      await prisma.attendanceRequest.updateMany({
        where: { id: { in: conflicting.map((r) => r.id) } },
        data: { status: "REJECTED", reviewNote: `Diganti jadi ${action} oleh BoD dari crew board.`, reviewedAt: new Date(), reviewedById: session.user.id, approvalSource: "ADMIN" },
      })
    }

    // NOTE: a DAY_OFF created here intentionally BYPASSES the monthly quota cap — same policy as a
    // BoD grant (isGrant) in the requests route. The BoD is explicitly rewriting the day's status.
    const primary = await getPrimaryAttendanceTeam(targetUserId, workspaceId)
    await prisma.attendanceRequest.create({
      data: {
        userId: targetUserId,
        workspaceId,
        teamId: primary?.teamId ?? null,
        type: action,
        status: "APPROVED",
        startDate: date,
        endDate: date,
        reason: (body.note ?? "").trim() || `Status ${dateKey} diubah jadi ${action} oleh BoD dari crew board.`,
        reviewNote: "Diubah oleh BoD dari crew board.",
        approvalSource: "ADMIN",
        reviewedAt: new Date(),
        reviewedById: session.user.id,
      },
    })

    await logOverride(req, session.user.id, workspaceId, targetUserId, dateKey, action, { refunded, replacedRequests: conflicting.length, closedAttendance: closed.count })
    return NextResponse.json({ ok: true, action, date: dateKey, refunded, replacedRequests: conflicting.length, closedAttendance: closed.count })
  } catch (error) {
    console.error("attendance override error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}

async function logOverride(
  req: NextRequest,
  adminUserId: string,
  workspaceId: string,
  targetUserId: string,
  dateKey: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await logAudit({
    action: "attendance_status_override",
    entityType: "attendance_day",
    entityId: `${targetUserId}:${dateKey}`,
    entityName: `override:${action}:${dateKey}`,
    userId: adminUserId,
    request: req,
    metadata: { workspaceId, targetUserId, date: dateKey, override: action, ...metadata },
  })
}
