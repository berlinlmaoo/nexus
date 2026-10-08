import prisma from "@/lib/prisma"
import type { FormerMember, WorkspaceMember, WorkspaceRole } from "@/generated/prisma/client"

/**
 * People who left a workspace (owner, 8 Oct 2026: offboarding a resignation without losing anything).
 *
 * Offboarding deletes the WorkspaceMember row exactly like "remove member" always has, so every
 * operational list, cron, picker and approver lookup skips the person with no change. What that row
 * said — role, join date, rest days, quota, approver, shifts — is kept in FormerMember with `leftAt`,
 * the last working day. Recaps of periods the person was still part of read them back from here.
 */

/** The member row as it was, plus the day they left. `leftAt` null = still a member. */
export type MemberAsOf = Omit<WorkspaceMember, "id"> & { id: string; leftAt: Date | null }

/** "2026-10-10": the last working day as an attendance date key (attendanceDate is 00:00 UTC). */
export function leftKeyOf(leftAt: Date | null | undefined): string | null {
  return leftAt ? leftAt.toISOString().slice(0, 10) : null
}

/** True when `dateKey` ("YYYY-MM-DD") is after the person left: nothing is expected of them then. */
export function isAfterLeaving(dateKey: string, leftAt: Date | null | undefined): boolean {
  const left = leftKeyOf(leftAt)
  return left !== null && dateKey > left
}

/** A FormerMember read back as the member row it was. */
export function asMemberAsOf(f: FormerMember): MemberAsOf {
  const row = (f.member ?? {}) as Record<string, unknown>
  const date = (v: unknown): Date | null => (typeof v === "string" || v instanceof Date ? new Date(v) : null)
  return {
    id: typeof row.id === "string" ? row.id : f.id,
    role: f.role as WorkspaceRole,
    attendanceRole: (row.attendanceRole as WorkspaceMember["attendanceRole"]) ?? "NONE",
    joinedAt: f.joinedAt,
    attendanceShiftStartTime: (row.attendanceShiftStartTime as string | null) ?? null,
    attendanceShiftEndTime: (row.attendanceShiftEndTime as string | null) ?? null,
    attendanceShiftByDay: (row.attendanceShiftByDay as WorkspaceMember["attendanceShiftByDay"]) ?? null,
    dayOffQuota: f.dayOffQuota,
    employmentStartDate: f.employmentStartDate ?? date(row.employmentStartDate),
    flexiTimeEnabled: row.flexiTimeEnabled === true,
    restDays: f.restDays ?? [],
    noGeofenceMode: row.noGeofenceMode === true,
    approverId: f.approverId,
    userId: f.userId,
    workspaceId: f.workspaceId,
    leftAt: f.leftAt,
  }
}

/**
 * Former members of a workspace who were still there on or after `from` (a period start), i.e. who
 * belong in a recap of that period. Optionally limited to some users.
 */
export async function formerMembersSince(
  workspaceId: string,
  from: Date,
  userIds?: string[],
): Promise<FormerMember[]> {
  return prisma.formerMember.findMany({
    where: { workspaceId, leftAt: { gte: from }, ...(userIds ? { userId: { in: userIds } } : {}) },
  })
}

/** userId → leftAt for the former members among `userIds` in this workspace (any date). */
export async function leftAtByUser(workspaceId: string, userIds: string[]): Promise<Map<string, Date>> {
  if (!userIds.length) return new Map()
  const rows = await prisma.formerMember.findMany({
    where: { workspaceId, userId: { in: userIds } },
    select: { userId: true, leftAt: true },
  })
  return new Map(rows.map((r) => [r.userId, r.leftAt]))
}
