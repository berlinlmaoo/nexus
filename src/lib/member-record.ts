import prisma from "@/lib/prisma"
import { attendancePeriodKey, formatAttendanceDateKey } from "@/lib/attendance"
import { classifyAttendanceDays, type ClassifiedAttendanceDay } from "@/lib/attendance-days"
import { isAutoDeduction } from "@/lib/attendance-absence"
import { dayOffUsageKey, dayOffUsedByPeriod, effectiveDayOffQuota } from "@/lib/day-off-usage"
import { addDaysToKey, makeReportWindow, type ReportWindow } from "@/lib/people-reports"
import { describeXpReason, type XpReasonKind } from "@/lib/xp-reason"

/**
 * One person's record for one attendance period (28th → 27th) — the data behind the member record
 * page on the web (/people/:userId) and the iPhone (MemberProfileView). GET /api/members/[userId]/record.
 *
 * Every figure is decided here so the two clients cannot drift:
 *   - the days come from classifyAttendanceDays, the same rules as the crew board and the Sheets
 *     export (a record; an approved request replaces it; else ABSENT on a past workday);
 *   - Score = min(worked, working)/working (+surplus), worked = present + permit days, working = the
 *     period's days − the effective day-off allowance (base + extra days for THIS period) — the board's
 *     Score column;
 *   - XP = the ledger rows written inside the period's window [28th 00:00 WIB, 28th of the next month
 *     00:00 WIB), the same window Reports per crew uses. An attendance penalty also carries the DAY it
 *     is about (`dateKey`), which is usually the day before it was written.
 */

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function shortDay(key: string) {
  const [, m, d] = key.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

/** "28 Aug – 27 Sep 2026" */
export function periodRangeLabel(from: string, to: string) {
  return `${shortDay(from)} – ${shortDay(to)} ${to.slice(0, 4)}`
}

/** The attendance period window for "YYYY-MM" (28th of the month before → 27th). */
export function recordWindow(periodKey: string): ReportWindow {
  const [y, m] = periodKey.split("-").map(Number)
  const to = `${y}-${String(m).padStart(2, "0")}-27`
  const from = addDaysToKey(`${shiftMonthKey(periodKey, -1)}-27`, 1)
  return makeReportWindow(from, to, periodKey)
}

/** Validate ?period=: "YYYY-MM", not after the current period. Default: the current period. */
export function parseRecordPeriod(raw: string | null | undefined): { ok: true; key: string } | { ok: false; error: string; code: string } {
  const current = attendancePeriodKey()
  const key = (raw ?? "").trim() || current
  if (!MONTH_KEY.test(key)) return { ok: false, error: "Periode harus format YYYY-MM.", code: "BAD_PERIOD" }
  if (key > current) return { ok: false, error: "Periode itu belum dimulai.", code: "PERIOD_IN_FUTURE" }
  if (key < "2020-01") return { ok: false, error: "Periode terlalu lama.", code: "BAD_PERIOD" }
  return { ok: true, key }
}

/** The board's colour letter for a classified day (same letters as history?compact=1). */
export function toneOfDay(d: ClassifiedAttendanceDay | undefined): "P" | "L" | "I" | "C" | "S" | "D" | "A" | "" {
  if (!d) return ""
  switch (d.dayType) {
    case "PRESENT": return d.lateMinutes > 0 ? "L" : "P"
    case "PERMIT_APPROVED": return "I"
    case "LEAVE_APPROVED": return "C"
    case "SICK_APPROVED": return "S"
    case "DAY_OFF_APPROVED": return "D"
    case "ABSENT": return "A"
    default: return ""
  }
}

export interface RecordCounts {
  present: number
  permit: number
  leave: number
  sick: number
  dayOff: number
  absent: number
  lateDays: number
  lateMinutes: number
}

/** Count a person's classified days. Pure. */
export function countDays(days: ReadonlyArray<ClassifiedAttendanceDay>): RecordCounts {
  const c: RecordCounts = { present: 0, permit: 0, leave: 0, sick: 0, dayOff: 0, absent: 0, lateDays: 0, lateMinutes: 0 }
  for (const d of days) {
    switch (d.dayType) {
      case "PRESENT":
        c.present++
        if (d.lateMinutes > 0) { c.lateDays++; c.lateMinutes += d.lateMinutes }
        break
      case "PERMIT_APPROVED": c.permit++; break
      case "LEAVE_APPROVED": c.leave++; break
      case "SICK_APPROVED": c.sick++; break
      case "DAY_OFF_APPROVED": c.dayOff++; break
      case "ABSENT": c.absent++; break
    }
  }
  return c
}

/** The board's Score: "22/22 +3". worked = present + permit; working = days − allowance. Pure. */
export function recordScore(periodDays: number, allowance: number, counts: Pick<RecordCounts, "present" | "permit">) {
  const working = Math.max(0, periodDays - allowance)
  const worked = counts.present + counts.permit
  return { worked: Math.min(worked, working), working, surplus: Math.max(0, worked - working), totalWorked: worked }
}

export type RecordXpEntry = {
  id: string
  /** What the row holds now (0 once removed). */
  amount: number
  /** What it was written as (the deduction before it was removed). */
  originalAmount: number
  createdAt: string
  reason: string
  kind: XpReasonKind
  label: string
  dateKey: string | null
  detail: string | null
  lateMinutes: number | null
  attendance: boolean
  removed: { at: string; by: { id: string; name: string | null } | null; note: string | null } | null
  canRemove: boolean
}

const LATE_PREFIX = "attendance:late:"

/** The XP part: ledger rows written inside the window + removed ones whose row a whole-day clear has since deleted. */
export async function buildRecordXp(opts: {
  workspaceId: string
  userId: string
  window: ReportWindow
  canRemove: boolean
}) {
  const { workspaceId, userId, window: w } = opts
  const [txns, refunds, older] = await Promise.all([
    prisma.xpTransaction.findMany({
      where: { userId, createdAt: { gte: w.fromAt, lt: w.toAt } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { id: true, amount: true, reason: true, createdAt: true },
    }),
    prisma.xpRefund.findMany({
      where: { userId, originalCreatedAt: { gte: w.fromAt, lt: w.toAt } },
      select: {
        transactionId: true, amount: true, reason: true, originalCreatedAt: true, createdAt: true, note: true,
        refundedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.xpTransaction.findFirst({ where: { userId, createdAt: { lt: w.fromAt } }, select: { id: true } }),
  ])
  const refundByTx = new Map(refunds.map((r) => [r.transactionId, r]))

  // Exact (uncapped) late minutes from the checked-in record, as the XP logs do.
  const lateKeys = [...new Set(txns.filter((t) => t.reason.startsWith(LATE_PREFIX)).map((t) => t.reason.slice(LATE_PREFIX.length, LATE_PREFIX.length + 10)))]
  const lateByDay = new Map<string, number>()
  if (lateKeys.length > 0) {
    const recs = await prisma.attendanceRecord.findMany({
      where: { userId, workspaceId, attendanceDate: { in: lateKeys.map((d) => new Date(`${d}T00:00:00.000Z`)) } },
      select: { attendanceDate: true, checkInAt: true, lateMinutes: true },
    })
    for (const r of recs) if (r.checkInAt && (r.lateMinutes ?? 0) > 0) lateByDay.set(formatAttendanceDateKey(r.attendanceDate), r.lateMinutes as number)
  }

  const entries: RecordXpEntry[] = []
  const seen = new Set<string>()
  for (const t of txns) {
    seen.add(t.id)
    const refund = refundByTx.get(t.id)
    const originalAmount = refund ? refund.amount : t.amount
    const lateMinutes = t.reason.startsWith(LATE_PREFIX) ? lateByDay.get(t.reason.slice(LATE_PREFIX.length, LATE_PREFIX.length + 10)) ?? null : null
    const info = describeXpReason(t.reason, originalAmount, lateMinutes)
    // The waiver marker, and any other row that never moved XP, is bookkeeping — not a line on a record.
    if (info.hidden || (!refund && t.amount === 0)) continue
    entries.push({
      id: t.id,
      amount: t.amount,
      originalAmount,
      createdAt: t.createdAt.toISOString(),
      reason: t.reason,
      kind: info.kind,
      label: info.label,
      dateKey: info.dateKey,
      detail: info.detail,
      lateMinutes,
      attendance: info.attendance,
      removed: refund ? { at: refund.createdAt.toISOString(), by: refund.refundedBy ?? null, note: refund.note } : null,
      canRemove: opts.canRemove && !refund && t.amount < 0,
    })
  }
  // Removed, then the whole day was cleared (the row is gone): the removal is still history.
  for (const r of refunds) {
    if (seen.has(r.transactionId)) continue
    const info = describeXpReason(r.reason, r.amount)
    entries.push({
      id: r.transactionId,
      amount: 0,
      originalAmount: r.amount,
      createdAt: r.originalCreatedAt.toISOString(),
      reason: r.reason,
      kind: info.kind,
      label: info.label,
      dateKey: info.dateKey,
      detail: info.detail,
      lateMinutes: null,
      attendance: info.attendance,
      removed: { at: r.createdAt.toISOString(), by: r.refundedBy ?? null, note: r.note },
      canRemove: false,
    })
  }
  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

  const gained = entries.reduce((s, e) => s + (e.amount > 0 ? e.amount : 0), 0)
  const lost = entries.reduce((s, e) => s + (e.amount < 0 ? e.amount : 0), 0)
  const removed = entries.reduce((s, e) => s + (e.removed && e.originalAmount < 0 ? -e.originalAmount : 0), 0)
  return {
    period: w.key,
    entries,
    totals: { gained, lost, net: gained + lost, removed },
    hasOlder: Boolean(older),
    olderPeriod: w.key ? shiftMonthKey(w.key, -1) : null,
  }
}

/** Every attendance penalty reason key a day of [from, to] can carry (late, no check-out, TK). */
export function periodPenaltyReasons(from: string, to: string): string[] {
  const out: string[] = []
  for (let key = from; key <= to; key = addDaysToKey(key, 1)) {
    out.push(`attendance:late:${key}`, `attendance:nocheckout:${key}`, `attendance:alpha:${key}`)
  }
  return out
}

/** The whole record for one period. `canManage` = the viewer is BoD / OAA / system admin. */
export async function buildMemberRecord(opts: {
  workspaceId: string
  userId: string
  periodKey: string
  viewerId: string
  canManage: boolean
}) {
  const { workspaceId, userId, periodKey } = opts
  const w = recordWindow(periodKey)
  const isSelf = opts.viewerId === userId
  const todayKey = formatAttendanceDateKey()

  const [classified, allowance, usedMap, requests, penaltyRows, xp] = await Promise.all([
    classifyAttendanceDays({ workspaceId, userIds: [userId], start: w.fromDate, end: w.toDate }),
    effectiveDayOffQuota(workspaceId, userId, periodKey),
    dayOffUsedByPeriod([{ userId, periodKey }]),
    prisma.attendanceRequest.findMany({
      where: { workspaceId, userId, startDate: { lte: w.toDate }, endDate: { gte: w.fromDate } },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true, type: true, status: true, startDate: true, endDate: true, reason: true, createdAt: true,
        reviewedAt: true, reviewedById: true, approvalSource: true, reviewNote: true,
        reviewedBy: { select: { id: true, name: true } },
      },
    }),
    // What each day of the period cost, whenever it was written (the cron writes yesterday's today).
    prisma.xpTransaction.findMany({
      where: { userId, amount: { lt: 0 }, reason: { in: periodPenaltyReasons(w.from, w.to) } },
      select: { reason: true, amount: true },
    }),
    buildRecordXp({ workspaceId, userId, window: w, canRemove: opts.canManage && !isSelf }),
  ])

  const days = classified.get(userId) ?? []
  const byKey = new Map(days.map((d) => [d.dateKey, d]))
  const penaltyByDay = new Map<string, number>()
  for (const p of penaltyRows) {
    const key = describeXpReason(p.reason).dateKey
    if (!key || key < w.from || key > w.to) continue
    penaltyByDay.set(key, (penaltyByDay.get(key) ?? 0) + p.amount)
  }

  const counts = countDays(days)
  const score = recordScore(w.days, allowance.quota, counts)
  const usedRaw = usedMap.get(dayOffUsageKey(userId, periodKey)) ?? 0

  const cells: {
    date: string; day: number; weekday: string; tone: string; isToday: boolean; isFuture: boolean
    lateMinutes: number; penaltyXp: number
  }[] = []
  for (let key = w.from; key <= w.to; key = addDaysToKey(key, 1)) {
    const d = byKey.get(key)
    const dow = new Date(`${key}T00:00:00.000Z`).getUTCDay()
    cells.push({
      date: key,
      day: Number(key.slice(8, 10)),
      weekday: WEEKDAYS[dow],
      tone: toneOfDay(d),
      isToday: key === todayKey,
      isFuture: key > todayKey,
      lateMinutes: d?.lateMinutes ?? 0,
      penaltyXp: penaltyByDay.get(key) ?? 0,
    })
  }

  const clip = (s: Date, e: Date) => {
    const a = s.getTime() < w.fromDate.getTime() ? w.fromDate : s
    const b = e.getTime() > w.toDate.getTime() ? w.toDate : e
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1)
  }

  return {
    period: {
      key: periodKey,
      from: w.from,
      to: w.to,
      label: periodRangeLabel(w.from, w.to),
      isCurrent: w.isCurrent,
      days: w.days,
      daysElapsed: w.daysElapsed,
      previousKey: shiftMonthKey(periodKey, -1),
      nextKey: periodKey < attendancePeriodKey() ? shiftMonthKey(periodKey, 1) : null,
    },
    summary: {
      score,
      counts,
      dayOff: {
        quota: allowance.quota,
        baseQuota: allowance.base,
        bonusDays: allowance.bonus,
        bonusGrants: allowance.grants.map((g) => ({ days: g.days, reason: g.reason })),
        used: Math.min(usedRaw, allowance.quota),
        usedRaw,
        remaining: Math.max(0, allowance.quota - usedRaw),
      },
      xp: xp.totals,
    },
    days: cells,
    xp: { entries: xp.entries, hasOlder: xp.hasOlder, olderPeriod: xp.olderPeriod },
    requests: requests.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      startDate: formatAttendanceDateKey(r.startDate),
      endDate: formatAttendanceDateKey(r.endDate),
      days: clip(r.startDate, r.endDate),
      reason: r.reason,
      reviewNote: r.reviewNote ?? null,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedBy: r.reviewedBy ?? null,
      /** The cron's own day-off cut (TK / >120 min late) — a penalty, not something they filed. */
      isAuto: isAutoDeduction(r),
    })),
  }
}
