import prisma from "@/lib/prisma"
import { attendancePeriodRange, enumerateAttendanceDates, formatAttendanceDateKey } from "@/lib/attendance"
import { isAutoDeduction } from "@/lib/attendance-absence"
import { DEFAULT_DAY_OFF_QUOTA, dayOffUsageKey, effectiveDayOffQuotas } from "@/lib/day-off-usage"
import { leftKeyOf } from "@/lib/former-members"
import { formerMembersOf } from "@/lib/former-recaps"

const DEFAULT_DAYOFF_QUOTA = DEFAULT_DAY_OFF_QUOTA

const XP_KIND: Record<string, { kind: string; label: string }> = {
  late: { kind: "XP_LATE", label: "Telat check-in" },
  nocheckout: { kind: "XP_NOCHECKOUT", label: "Lupa check-out" },
  alpha: { kind: "XP_ALPHA", label: "Alpha (nggak absen)" },
}

/**
 * One person's attendance deduction log for an attendance period (28→27): every XP cut and every auto-deducted
 * day off, with whether it was cleared (a waiver marker for that date), and the period's day-off allowance.
 * The body of GET /api/attendance/deductions?userId= (moved here verbatim, 17 Nov 2026) so the MCP read tool reads the
 * very same ledgers the crew board's log shows. null = not a member (nor a former member) of the workspace.
 */
export async function readDeductionLog(workspaceId: string, userId: string, month: string) {
  const { start, end } = attendancePeriodRange(month)
  // ── Per-member mode: the deduction log ────────────────────────────────────
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  })
  // Someone who left this workspace keeps their log (offboarding: nothing of theirs is deleted).
  const former = member ? null : (await formerMembersOf(workspaceId, { userIds: [userId] }))[0] ?? null
  if (!member && !former) return null

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

  const allowance = (await effectiveDayOffQuotas(workspaceId, [{ userId, periodKey: month }])).get(dayOffUsageKey(userId, month))
  const quota = allowance?.quota ?? DEFAULT_DAYOFF_QUOTA
  const usedRows = requests.filter((r) => r.status === "PENDING" || r.status === "APPROVED")
  const used = usedRows.reduce((sum, d) => {
    const clipStart = d.startDate.getTime() < start.getTime() ? start : d.startDate
    const clipEnd = d.endDate.getTime() > end.getTime() ? end : d.endDate
    return sum + enumerateAttendanceDates(clipStart, clipEnd).length
  }, 0)

  return {
    month,
    userId,
    dayOff: {
      quota, used: Math.min(used, quota), remaining: Math.max(0, quota - used),
      // Additive (17 Nov 2026): the uncapped count, so a refund preview can say what the balance becomes.
      usedTotal: used,
      baseQuota: allowance?.base ?? DEFAULT_DAYOFF_QUOTA,
      bonus: { days: allowance?.bonus ?? 0, grants: (allowance?.grants ?? []).map((g) => ({ days: g.days, reason: g.reason })) },
    },
    totalXpLost: entries.filter((e) => e.unit === "XP" && !e.cleared).reduce((s, e) => s + e.amount, 0),
    entries,
    ...(former ? { leftAt: leftKeyOf(former.leftAt) } : {}),
  }
}
