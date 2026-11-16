export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  attendanceMonthRange,
  attendancePeriodKey,
  attendancePeriodRange,
  enumerateAttendanceDates,
  getAttendanceWorkspaceContext,
} from "@/lib/attendance"
import { PERIOD_BASELINE_XP, getLeaderboardPeriodStart, levelForXp } from "@/lib/gamification"
import { getAttendanceSheetUrl } from "@/lib/attendance-sheet"
import { DEFAULT_DAY_OFF_QUOTA, dayOffUsageKey, effectiveDayOffQuotas } from "@/lib/day-off-usage"
import { leftKeyOf } from "@/lib/former-members"
import { formerMembersOf } from "@/lib/former-recaps"
import { readDeductionLog } from "@/lib/attendance-deduction-log"

const DEFAULT_DAYOFF_QUOTA = DEFAULT_DAY_OFF_QUOTA
const MONTH_RE = /^\d{4}-\d{2}$/

// Attendance deductions for the crew board.
//
//   GET ?month=YYYY-MM              -> day-off usage for EVERY member (the table's "sisa day off")
//   GET ?month=YYYY-MM&userId=…     -> that member's full deduction log: every XP cut and every
//                                      auto-deducted day-off, with the reason and whether it's
//                                      already been cleared
//
// People who left (offboarding, 8 Oct 2026) are in the table for the periods they were still there for
// (last working day on/after the period start), with an additive `leftAt` ("YYYY-MM-DD"), and their
// log still opens.
//
// BoD-only: this exposes one person's penalties to another, which is exactly the crew board's gate.
// Clearing a deduction is NOT here — it's POST /api/attendance/override { action: "CLEAR_PENALTY" },
// which already refunds the XP, restores the auto day-off, and writes the waiver that stops the
// nightly cron re-applying it.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const ctx = await getAttendanceWorkspaceContext(session.user.id)
    if (!ctx.workspace) return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    // Reading only: BoD / OAA, and Staff Management (read-only viewer, owner 27 Oct 2026).
    if (!ctx.canViewAllAttendance) {
      return NextResponse.json({ error: "Hanya direksi ke atas yang bisa lihat potongan orang lain." }, { status: 403 })
    }
    const workspaceId = ctx.workspace.id

    const month = (req.nextUrl.searchParams.get("month") ?? "").trim() || attendancePeriodKey()
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Bulan harus format YYYY-MM." }, { status: 400 })
    const { start, end } = attendancePeriodRange(month)
    const userId = (req.nextUrl.searchParams.get("userId") ?? "").trim()

    // ── Bulk mode: per-member day-off, tanggal-merah and XP, for the table ─────
    if (!userId) {
      // ⚠️ THREE DIFFERENT WINDOWS, and using the wrong one silently produces wrong numbers:
      //   DAY_OFF   → the attendance period (cut-off 28→27)      — attendancePeriodRange
      //   RED_DATE  → the CALENDAR month                         — attendanceMonthRange
      //   XP        → the leaderboard period (resets on the 1st)  — getLeaderboardPeriodStart
      // That's how the quota checks in the requests route and the leaderboard already count them.
      const monthRange = attendanceMonthRange(month)
      const xpSince = getLeaderboardPeriodStart()

      const [currentMembers, formers, dayoffs, redDates, redQuotaRow, xpAgg] = await Promise.all([
        prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } }),
        formerMembersOf(workspaceId, { leftSince: start }),
        prisma.attendanceRequest.findMany({
          where: {
            workspaceId, type: "DAY_OFF", status: { in: ["PENDING", "APPROVED"] },
            startDate: { lte: end }, endDate: { gte: start },
          },
          select: { userId: true, startDate: true, endDate: true },
        }),
        prisma.attendanceRequest.findMany({
          where: {
            workspaceId, type: "RED_DATE", status: { in: ["PENDING", "APPROVED"] },
            startDate: { lte: monthRange.end }, endDate: { gte: monthRange.start },
          },
          select: { userId: true, startDate: true, endDate: true },
        }),
        prisma.redDateQuota.findUnique({ where: { workspaceId_month: { workspaceId, month } }, select: { quota: true } }),
        prisma.xpTransaction.groupBy({
          by: ["userId"], _sum: { amount: true }, where: { createdAt: { gte: xpSince } },
        }),
      ])

      // Clip each request to its window so one spanning the boundary only counts the days inside —
      // the same rule the quota cap uses.
      const countInto = (
        map: Map<string, number>,
        rows: { userId: string; startDate: Date; endDate: Date }[],
        from: Date, to: Date,
      ) => {
        for (const r of rows) {
          const s0 = r.startDate.getTime() < from.getTime() ? from : r.startDate
          const e0 = r.endDate.getTime() > to.getTime() ? to : r.endDate
          map.set(r.userId, (map.get(r.userId) ?? 0) + enumerateAttendanceDates(s0, e0).length)
        }
      }
      const leftKeyByUser = new Map(formers.map((f) => [f.userId, leftKeyOf(f.leftAt)]))
      const members = [...currentMembers, ...formers.map((f) => ({ userId: f.userId }))]

      const usedDayOff = new Map<string, number>()
      const usedRedDate = new Map<string, number>()
      countInto(usedDayOff, dayoffs, start, end)
      countInto(usedRedDate, redDates, monthRange.start, monthRange.end)
      const xpDelta = new Map(xpAgg.map((r) => [r.userId, r._sum.amount ?? 0]))

      // 0 until BoD sets the month's jatah — that's the real default, not a missing value.
      const redQuota = redQuotaRow?.quota ?? 0
      // Day-off allowance for THIS period: base + the extra days granted for it (lib/day-off-usage).
      const allowance = await effectiveDayOffQuotas(workspaceId, members.map((m) => ({ userId: m.userId, periodKey: month })))

      return NextResponse.json({
        month,
        // The live Google Sheet (POST /api/cron/attendance-sheet); null until the sync has made it.
        attendanceSheetUrl: await getAttendanceSheetUrl(workspaceId),
        defaultQuota: DEFAULT_DAYOFF_QUOTA,
        redDateQuota: redQuota,
        members: members.map((m) => {
          const a = allowance.get(dayOffUsageKey(m.userId, month))
          const quota = a?.quota ?? DEFAULT_DAYOFF_QUOTA
          const used = usedDayOff.get(m.userId) ?? 0
          const redUsed = usedRedDate.get(m.userId) ?? 0
          const score = PERIOD_BASELINE_XP + (xpDelta.get(m.userId) ?? 0)
          const lvl = levelForXp(score)
          return {
            userId: m.userId,
            // Capped at the allowance for display (see lib/day-off-usage); enforcement counts real rows.
            quota, used: Math.min(used, quota), remaining: Math.max(0, quota - used),
            // Additive (28 Sep 2026): quota = baseQuota + bonus.days; bonus.grants for the tooltip.
            baseQuota: a?.base ?? DEFAULT_DAYOFF_QUOTA,
            bonus: { days: a?.bonus ?? 0, grants: (a?.grants ?? []).map((g) => ({ days: g.days, reason: g.reason })) },
            redDate: { quota: redQuota, used: Math.min(redUsed, redQuota), remaining: Math.max(0, redQuota - redUsed) },
            xp: { score, level: lvl.level, levelName: lvl.name },
            ...(leftKeyByUser.has(m.userId) ? { leftAt: leftKeyByUser.get(m.userId) } : {}),
          }
        }),
      })
    }

    // ── Per-member mode: the deduction log (lib/attendance-deduction-log.ts, shared with the MCP read tool) ──
    const log = await readDeductionLog(workspaceId, userId, month)
    if (!log) return NextResponse.json({ error: "Orang ini bukan member workspace." }, { status: 404 })
    return NextResponse.json(log)
  } catch (error) {
    console.error("Error listing attendance deductions:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
