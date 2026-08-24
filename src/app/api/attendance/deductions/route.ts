export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  attendanceMonthRange,
  attendancePeriodKey,
  attendancePeriodRange,
  enumerateAttendanceDates,
  formatAttendanceDateKey,
  getAttendanceWorkspaceContext,
} from "@/lib/attendance"
import { isAutoDeduction } from "@/lib/attendance-absence"
import { PERIOD_BASELINE_XP, getLeaderboardPeriodStart, levelForXp } from "@/lib/gamification"

const DEFAULT_DAYOFF_QUOTA = 4 // keep in sync with the dayoffs route
const MONTH_RE = /^\d{4}-\d{2}$/

// Attendance deductions for the crew board.
//
//   GET ?month=YYYY-MM              -> day-off usage for EVERY member (the table's "sisa day off")
//   GET ?month=YYYY-MM&userId=…     -> that member's full deduction log: every XP cut and every
//                                      auto-deducted day-off, with the reason and whether it's
//                                      already been cleared
//
// BoD-only: this exposes one person's penalties to another, which is exactly the crew board's gate.
// Clearing a deduction is NOT here — it's POST /api/attendance/override { action: "CLEAR_PENALTY" },
// which already refunds the XP, restores the auto day-off, and writes the waiver that stops the
// nightly cron re-applying it.

const XP_KIND: Record<string, { kind: string; label: string }> = {
  late: { kind: "XP_LATE", label: "Telat check-in" },
  nocheckout: { kind: "XP_NOCHECKOUT", label: "Lupa check-out" },
  alpha: { kind: "XP_ALPHA", label: "Alpha (nggak absen)" },
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const ctx = await getAttendanceWorkspaceContext(session.user.id)
    if (!ctx.workspace) return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    if (!ctx.canManageAttendance) {
      return NextResponse.json({ error: "Hanya BoD ke atas yang bisa lihat potongan orang lain." }, { status: 403 })
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

      const [members, dayoffs, redDates, redQuotaRow, xpAgg] = await Promise.all([
        prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, dayOffQuota: true } }),
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
      const usedDayOff = new Map<string, number>()
      const usedRedDate = new Map<string, number>()
      countInto(usedDayOff, dayoffs, start, end)
      countInto(usedRedDate, redDates, monthRange.start, monthRange.end)
      const xpDelta = new Map(xpAgg.map((r) => [r.userId, r._sum.amount ?? 0]))

      // 0 until BoD sets the month's jatah — that's the real default, not a missing value.
      const redQuota = redQuotaRow?.quota ?? 0

      return NextResponse.json({
        month,
        defaultQuota: DEFAULT_DAYOFF_QUOTA,
        redDateQuota: redQuota,
        members: members.map((m) => {
          const quota = m.dayOffQuota ?? DEFAULT_DAYOFF_QUOTA
          const used = usedDayOff.get(m.userId) ?? 0
          const redUsed = usedRedDate.get(m.userId) ?? 0
          const score = PERIOD_BASELINE_XP + (xpDelta.get(m.userId) ?? 0)
          const lvl = levelForXp(score)
          return {
            userId: m.userId,
            quota, used, remaining: Math.max(0, quota - used),
            redDate: { quota: redQuota, used: redUsed, remaining: Math.max(0, redQuota - redUsed) },
            xp: { score, level: lvl.level, levelName: lvl.name },
          }
        }),
      })
    }

    // ── Per-member mode: the deduction log ────────────────────────────────────
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { dayOffQuota: true },
    })
    if (!member) return NextResponse.json({ error: "Orang ini bukan member workspace." }, { status: 404 })

    const [txns, requests] = await Promise.all([
      prisma.xpTransaction.findMany({
        where: { userId, reason: { startsWith: "attendance:" }, createdAt: { gte: start, lte: new Date(end.getTime() + 86_400_000) } },
        select: { id: true, amount: true, reason: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.attendanceRequest.findMany({
        where: {
          workspaceId, userId, type: "DAY_OFF",
          startDate: { lte: end }, endDate: { gte: start },
        },
        select: {
          id: true, startDate: true, endDate: true, reason: true, status: true,
          reviewedById: true, approvalSource: true,
        },
        orderBy: { startDate: "desc" },
      }),
    ])

    // A waiver row (amount 0, reason attendance:waiver:<date>) marks a date as already cleared —
    // it's what stops the nightly cron re-deriving the penalty, so it's the truth for "cleared".
    const waived = new Set(
      txns
        .filter((t) => t.reason.startsWith("attendance:waiver:"))
        .map((t) => t.reason.slice("attendance:waiver:".length))
        .filter(Boolean),
    )

    type Entry = {
      id: string
      dateKey: string
      kind: string
      label: string
      amount: number      // XP delta (negative), or -1 day for a day-off cut
      unit: "XP" | "DAY_OFF"
      detail: string | null
      cleared: boolean
    }
    const entries: Entry[] = []

    for (const t of txns) {
      const [, kindKey, dateKey] = t.reason.split(":")
      const meta = XP_KIND[kindKey ?? ""]
      // Skip waiver markers (amount 0) and anything not a real penalty.
      if (!meta || !dateKey || t.amount >= 0) continue
      entries.push({
        id: t.id,
        dateKey,
        kind: meta.kind,
        label: meta.label,
        amount: t.amount,
        unit: "XP",
        detail: null,
        cleared: waived.has(dateKey),
      })
    }

    for (const r of requests) {
      // Only AUTO-deducted day-offs are penalties; one the person requested themselves isn't.
      if (!isAutoDeduction(r)) continue
      for (const d of enumerateAttendanceDates(
        r.startDate.getTime() < start.getTime() ? start : r.startDate,
        r.endDate.getTime() > end.getTime() ? end : r.endDate,
      )) {
        const dateKey = formatAttendanceDateKey(d)
        entries.push({
          id: `${r.id}:${dateKey}`,
          dateKey,
          kind: "DAYOFF_AUTO",
          label: "Day-off kepotong otomatis",
          amount: -1,
          unit: "DAY_OFF",
          detail: r.reason ?? null,
          cleared: waived.has(dateKey),
        })
      }
    }

    entries.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))

    const quota = member.dayOffQuota ?? DEFAULT_DAYOFF_QUOTA
    const usedRows = requests.filter((r) => r.status === "PENDING" || r.status === "APPROVED")
    const used = usedRows.reduce((sum, d) => {
      const clipStart = d.startDate.getTime() < start.getTime() ? start : d.startDate
      const clipEnd = d.endDate.getTime() > end.getTime() ? end : d.endDate
      return sum + enumerateAttendanceDates(clipStart, clipEnd).length
    }, 0)

    return NextResponse.json({
      month,
      userId,
      dayOff: { quota, used, remaining: Math.max(0, quota - used) },
      totalXpLost: entries.filter((e) => e.unit === "XP" && !e.cleared).reduce((s, e) => s + e.amount, 0),
      entries,
    })
  } catch (error) {
    console.error("Error listing attendance deductions:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
