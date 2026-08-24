export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { ANNUAL_LEAVE_DAYS, checkLeaveEligibility, eligibleFrom } from "@/lib/annual-leave"

// Employment start date per member — the basis for annual-leave eligibility.
//
//   GET                       -> every member + their start date and eligibility (crew board)
//   PATCH { userId, date }    -> set it; date = "YYYY-MM-DD", or null/"" to clear
//
// BoD-only, mirroring the day-off quota route this sits next to: same gate, same audit shape.
async function gate() {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const ctx = await getAttendanceWorkspaceContext(session.user.id)
  if (!ctx.workspace) return { error: NextResponse.json({ error: "No workspace membership found" }, { status: 404 }) }
  if (!ctx.canManageAttendance) {
    return { error: NextResponse.json({ error: "Hanya BoD ke atas yang bisa set tanggal mulai kerja." }, { status: 403 }) }
  }
  return { session, workspaceId: ctx.workspace.id }
}

export async function GET() {
  try {
    const g = await gate()
    if (g.error) return g.error

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: g.workspaceId },
      select: {
        userId: true,
        employmentStartDate: true,
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    })

    const rows = members.map((m) => {
      const eligibility = checkLeaveEligibility(m.employmentStartDate)
      return {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        avatar: m.user.avatar,
        employmentStartDate: m.employmentStartDate,
        eligible: eligibility.eligible,
        eligibleFrom: m.employmentStartDate ? eligibleFrom(m.employmentStartDate) : null,
      }
    })
    rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "id"))

    return NextResponse.json({ members: rows, quota: ANNUAL_LEAVE_DAYS })
  } catch (error) {
    console.error("Error listing employment start dates:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const g = await gate()
    if (g.error) return g.error

    const body = await req.json().catch(() => ({}))
    const userId = String(body?.userId ?? "").trim()
    if (!userId) return NextResponse.json({ error: "userId wajib." }, { status: 400 })

    let date: Date | null = null
    const raw = body?.date
    if (raw !== null && raw !== undefined && raw !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        return NextResponse.json({ error: "Tanggal harus format YYYY-MM-DD." }, { status: 400 })
      }
      // Stored at UTC midnight so the eligibility maths never shifts a day across timezones.
      date = new Date(`${raw}T00:00:00.000Z`)
      if (Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: "Tanggalnya nggak valid." }, { status: 400 })
      }
      // A start date in the future would grant eligibility even later, which is harmless, but it's
      // almost always a typo — say so rather than silently accept it.
      if (date.getTime() > Date.now()) {
        return NextResponse.json({ error: "Tanggal mulai kerja nggak boleh di masa depan." }, { status: 400 })
      }
    }

    const target = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: g.workspaceId } },
      select: { id: true },
    })
    if (!target) return NextResponse.json({ error: "User bukan member workspace ini." }, { status: 404 })

    await prisma.workspaceMember.update({
      where: { id: target.id },
      data: { employmentStartDate: date },
    })

    try {
      await logAudit({
        action: "update",
        entityType: "workspace_member",
        entityId: target.id,
        entityName: `employment-start:${userId}`,
        userId: g.session.user.id,
        request: req,
        metadata: { reason: "admin_employment_start", date: date ? date.toISOString() : null },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({
      employmentStartDate: date,
      eligibleFrom: date ? eligibleFrom(date) : null,
      eligible: checkLeaveEligibility(date).eligible,
    })
  } catch (error) {
    console.error("Error setting employment start date:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
