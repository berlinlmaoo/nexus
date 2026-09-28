import prisma from "@/lib/prisma"
import { attendancePeriodKey, attendancePeriodRange, enumerateAttendanceDates, formatAttendanceDateKey } from "@/lib/attendance"
import { combineDayOffQuota, sumBonusDays, type EffectiveDayOffQuota } from "@/lib/day-off-bonus"

/**
 * Day-off usage per (person, 28→27 period) — THE count the DAY_OFF quota cap in
 * POST /api/attendance/requests enforces, lifted out of that route so every other place that states
 * a balance says the same number the cap will act on:
 *   - the cap itself (the route's DAY_OFF branch now calls this),
 *   - the izin guard's "sisa jatah kamu periode ini: X hari",
 *   - `requesterDayOff` on the reviewer's queue,
 *   - the "Tercatat tanpa keterangan" push after a "tidak check-in" cut.
 *
 * The rule, unchanged from the route: every DAY_OFF row that is PENDING or APPROVED, whatever wrote it
 * (a person, a BoD grant, or the absence cron's "Auto: tidak check-in…" / "Auto: telat >120 menit…"
 * cuts — those ARE day off taken, over quota or not), is enumerated day by day, and each day is charged
 * to the period its date falls in. Keyed by user only, not workspace, exactly like the cap.
 *
 * Set-based: one query for any number of people and periods, so a list of 300 requests is one round
 * trip, not 300.
 *
 * The QUOTA side (28 Sep 2026): the allowance is per (person, period), not per person — the member's
 * dayOffQuota (default 4) plus any extra day off the BoD granted for that one period (DayOffBonus,
 * lib/day-off-bonus). Every reader goes through effectiveDayOffQuotas / dayOffQuotaByUser here, always
 * for the period of the day in question, never "now" unless now is the question.
 */

export const DEFAULT_DAY_OFF_QUOTA = 4

export interface DayOffBalance {
  quota: number
  used: number
  /** quota − used. Negative when the cron's cuts have taken someone past their quota ("minus"). */
  remaining: number
}

export const dayOffUsageKey = (userId: string, periodKey: string) => `${userId}|${periodKey}`

/** The 28→27 period ("YYYY-MM") a stored attendance date (00:00 UTC) belongs to. */
export function dayOffPeriodOf(date: Date): string {
  return attendancePeriodKey(formatAttendanceDateKey(date))
}

/** Map of `dayOffUsageKey(userId, periodKey)` → day-off days used. Absent key = 0. */
export async function dayOffUsedByPeriod(
  wanted: ReadonlyArray<{ userId: string; periodKey: string }>,
): Promise<Map<string, number>> {
  const used = new Map<string, number>()
  if (wanted.length === 0) return used
  const want = new Set(wanted.map((w) => dayOffUsageKey(w.userId, w.periodKey)))
  const userIds = Array.from(new Set(wanted.map((w) => w.userId)))
  const windows = Array.from(new Set(wanted.map((w) => w.periodKey))).map((k) => attendancePeriodRange(k))

  const rows = await prisma.attendanceRequest.findMany({
    where: {
      userId: { in: userIds },
      type: "DAY_OFF",
      status: { in: ["PENDING", "APPROVED"] },
      OR: windows.map((window) => ({ startDate: { lte: window.end }, endDate: { gte: window.start } })),
    },
    select: { userId: true, startDate: true, endDate: true },
  })
  for (const row of rows) {
    for (const date of enumerateAttendanceDates(row.startDate, row.endDate)) {
      const key = dayOffUsageKey(row.userId, dayOffPeriodOf(date))
      if (!want.has(key)) continue
      used.set(key, (used.get(key) ?? 0) + 1)
    }
  }
  return used
}

export interface DayOffBonusGrantSummary {
  id: string
  days: number
  reason: string
}

export interface EffectiveDayOffQuotaDetail extends EffectiveDayOffQuota {
  /** The non-revoked grants behind `bonus`, oldest first (for a tooltip: "4 + 3 extra (event)"). */
  grants: DayOffBonusGrantSummary[]
}

/**
 * THE quota reader. For each wanted (person, period): base (WorkspaceMember.dayOffQuota ?? 4) + the
 * extra days granted for exactly that period. Keyed like `dayOffUsageKey`. Two queries in total,
 * whatever the number of people and periods.
 *
 * A person who is not (or no longer) a member of the workspace gets the default base, as every
 * caller did before with `?? 4`; their grants in this workspace still count.
 */
export async function effectiveDayOffQuotas(
  workspaceId: string,
  wanted: ReadonlyArray<{ userId: string; periodKey: string }>,
): Promise<Map<string, EffectiveDayOffQuotaDetail>> {
  const out = new Map<string, EffectiveDayOffQuotaDetail>()
  if (wanted.length === 0) return out
  const userIds = Array.from(new Set(wanted.map((w) => w.userId)))
  const periodKeys = Array.from(new Set(wanted.map((w) => w.periodKey)))
  const [members, bonuses] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: userIds } },
      select: { userId: true, dayOffQuota: true },
    }),
    prisma.dayOffBonus.findMany({
      where: { workspaceId, userId: { in: userIds }, periodKey: { in: periodKeys }, revokedAt: null },
      select: { id: true, userId: true, periodKey: true, days: true, reason: true, revokedAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ])
  const baseByUser = new Map(members.map((m) => [m.userId, m.dayOffQuota]))
  const bonusByKey = sumBonusDays(bonuses)
  const grantsByKey = new Map<string, DayOffBonusGrantSummary[]>()
  for (const b of bonuses) {
    const key = dayOffUsageKey(b.userId, b.periodKey)
    grantsByKey.set(key, [...(grantsByKey.get(key) ?? []), { id: b.id, days: b.days, reason: b.reason }])
  }
  for (const w of wanted) {
    const key = dayOffUsageKey(w.userId, w.periodKey)
    const q = combineDayOffQuota(baseByUser.get(w.userId), bonusByKey.get(key) ?? 0, DEFAULT_DAY_OFF_QUOTA)
    out.set(key, { ...q, grants: grantsByKey.get(key) ?? [] })
  }
  return out
}

/**
 * Map of userId → that member's effective day-off quota in this workspace FOR `periodKey`: the
 * override (else the default 4) plus that period's extra days. The period is required on purpose —
 * a quota without a period is no longer a single number.
 */
export async function dayOffQuotaByUser(workspaceId: string, userIds: ReadonlyArray<string>, periodKey: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = Array.from(new Set(userIds))
  const quotas = await effectiveDayOffQuotas(workspaceId, ids.map((userId) => ({ userId, periodKey })))
  for (const id of ids) out.set(id, quotas.get(dayOffUsageKey(id, periodKey))?.quota ?? DEFAULT_DAY_OFF_QUOTA)
  return out
}

/** One person, one period — the effective allowance with its breakdown. */
export async function effectiveDayOffQuota(workspaceId: string, userId: string, periodKey: string): Promise<EffectiveDayOffQuotaDetail> {
  const got = (await effectiveDayOffQuotas(workspaceId, [{ userId, periodKey }])).get(dayOffUsageKey(userId, periodKey))
  return got ?? { ...combineDayOffQuota(null, 0, DEFAULT_DAY_OFF_QUOTA), grants: [] }
}

/**
 * Balance for many (workspace, person, period) at once — two queries per workspace in total.
 * Returns a map keyed like `dayOffUsageKey`.
 */
export async function dayOffBalances(
  workspaceId: string,
  wanted: ReadonlyArray<{ userId: string; periodKey: string }>,
): Promise<Map<string, DayOffBalance>> {
  const [used, quotas] = await Promise.all([
    dayOffUsedByPeriod(wanted),
    effectiveDayOffQuotas(workspaceId, wanted),
  ])
  const out = new Map<string, DayOffBalance>()
  for (const w of wanted) {
    const key = dayOffUsageKey(w.userId, w.periodKey)
    const quota = quotas.get(key)?.quota ?? DEFAULT_DAY_OFF_QUOTA
    const u = used.get(key) ?? 0
  // Shown, never more than the allowance. The allowance is the weekly rest (4 per period); cuts for
  // missed check-ins and heavy lateness keep landing after it is gone, but "22/4" reads like a bug
  // and the owner wants it to read 4/4. Enforcement never uses this figure — the DAY_OFF cap counts
  // the real rows (lib/day-off-usage dayOffUsedByPeriod), so capping the display loosens nothing.
    out.set(key, { quota, used: Math.min(u, quota), remaining: Math.max(0, quota - u) })
  }
  return out
}
