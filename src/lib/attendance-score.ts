import prisma from "@/lib/prisma"
import { formatAttendanceDateKey } from "@/lib/attendance"
import { attendanceStartKey } from "@/lib/former-member-days"
import { DEFAULT_DAY_OFF_QUOTA } from "@/lib/day-off-usage"

/**
 * The attendance Score's "out of" — ONE rule for the crew board (/api/attendance/history) and the
 * person record (/api/members/[id]/record), so the two never disagree (QA S-20, 13 Oct 2026).
 *
 * Someone who started during the period owes only the days from their first day: attendanceStartKey
 * (the day after joining, or an earlier first check-in — the same start the absence rules use), and the
 * day-off allowance shrinks in proportion. Everyone else owes the whole period with the full allowance.
 */
export type AttendanceOwed = { days: number; allowance: number; from: string }

/** Pure. `from`..`to` = the period's days (keys), `startKey` = when they owe attendance from. */
export function prorateForStart(from: string, to: string, periodDays: number, quota: number, startKey: string | null): AttendanceOwed {
  if (!startKey || startKey <= from) return { days: periodDays, allowance: quota, from }
  if (startKey > to) return { days: 0, allowance: 0, from: startKey }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / 86_400_000) + 1
  return { days, allowance: Math.round((quota * days) / periodDays), from: startKey }
}

/** Working days owed = days − allowance (never below 0). Pure. */
export const owedWorkingDays = (o: AttendanceOwed) => Math.max(0, o.days - o.allowance)

/**
 * Per person: what the Score of period [from, to] is out of. `quotas` = their effective day-off quota for
 * that period (dayOffQuotaByUser / effectiveDayOffQuota). Members and people who left are both read.
 */
export async function attendanceOwedFor(opts: {
  workspaceId: string
  userIds: string[]
  from: string
  to: string
  periodDays: number
  quotas: Map<string, number>
}): Promise<Map<string, AttendanceOwed>> {
  const ids = [...new Set(opts.userIds)]
  const out = new Map<string, AttendanceOwed>()
  if (ids.length === 0) return out
  const [members, formers, firsts] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId: opts.workspaceId, userId: { in: ids } }, select: { userId: true, joinedAt: true, user: { select: { createdAt: true } } } }),
    prisma.formerMember.findMany({ where: { workspaceId: opts.workspaceId, userId: { in: ids } }, select: { userId: true, joinedAt: true, user: { select: { createdAt: true } } } }),
    prisma.attendanceRecord.groupBy({ by: ["userId"], where: { workspaceId: opts.workspaceId, userId: { in: ids } }, _min: { attendanceDate: true } }),
  ])
  const joined = new Map<string, Date | null>()
  for (const f of formers) joined.set(f.userId, f.joinedAt ?? f.user?.createdAt ?? null)
  for (const m of members) joined.set(m.userId, m.joinedAt ?? m.user?.createdAt ?? null) // a current member row wins
  const first = new Map(firsts.map((r) => [r.userId, r._min.attendanceDate ? formatAttendanceDateKey(r._min.attendanceDate) : null] as const))
  for (const id of ids) {
    const j = joined.get(id) ?? null
    const start = j ? attendanceStartKey(formatAttendanceDateKey(j), first.get(id) ?? null) : null
    out.set(id, prorateForStart(opts.from, opts.to, opts.periodDays, opts.quotas.get(id) ?? DEFAULT_DAY_OFF_QUOTA, start))
  }
  return out
}
