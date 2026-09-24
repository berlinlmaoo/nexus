import prisma from "@/lib/prisma"
import { attendancePeriodKey, attendancePeriodRange, enumerateAttendanceDates, formatAttendanceDateKey } from "@/lib/attendance"

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

/** Map of userId → that member's day-off quota in this workspace (override, else the default 4). */
export async function dayOffQuotaByUser(workspaceId: string, userIds: ReadonlyArray<string>): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (userIds.length === 0) return out
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, userId: { in: Array.from(new Set(userIds)) } },
    select: { userId: true, dayOffQuota: true },
  })
  for (const m of members) out.set(m.userId, m.dayOffQuota ?? DEFAULT_DAY_OFF_QUOTA)
  return out
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
    dayOffQuotaByUser(workspaceId, wanted.map((w) => w.userId)),
  ])
  const out = new Map<string, DayOffBalance>()
  for (const w of wanted) {
    const key = dayOffUsageKey(w.userId, w.periodKey)
    const quota = quotas.get(w.userId) ?? DEFAULT_DAY_OFF_QUOTA
    const u = used.get(key) ?? 0
    out.set(key, { quota, used: u, remaining: quota - u })
  }
  return out
}
