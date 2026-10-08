import prisma from "@/lib/prisma"
import { asMemberAsOf, type MemberAsOf } from "@/lib/former-members"

/**
 * Former members in the recaps (offboarding, owner 8 Oct 2026) — the reading side of FormerMember for the
 * crew board, the Sheet, the deductions table, Reports per crew and the member record.
 *
 * Someone who was offboarded and later added back as an ordinary member (instead of "reinstate") has
 * both rows; the member row wins and they are NOT a former member here. Every query below says so with
 * `user.workspaceMembers none`.
 *
 * The operational side (TK detection, late accrual, reminders, approver lookups) never reads this file:
 * those keep working from WorkspaceMember, which no longer has the person.
 */

export const EXEMPT_ROLES = ["BOD", "ONE_ABOVE_ALL"] as const

/** BoD and One Above All are exempt from attendance — a former one stays exempt in the periods they were in. */
export function isExemptRole(role: string | null | undefined): boolean {
  return role === "BOD" || role === "ONE_ABOVE_ALL"
}

export type FormerRow = MemberAsOf & {
  leftAt: Date
  user: { id: string; name: string; email: string; avatar: string | null; createdAt: Date }
}

/**
 * The former members of a workspace who are not members again, as the member rows they were.
 * `leftSince`: only those still there on that day or later (the people a recap of a period starting
 * then lists). `userIds`: only these people. `approverId`: only those whose approver it was.
 */
export async function formerMembersOf(
  workspaceId: string,
  opts: { leftSince?: Date; userIds?: string[]; approverId?: string } = {},
): Promise<FormerRow[]> {
  if (opts.userIds && opts.userIds.length === 0) return []
  const rows = await prisma.formerMember.findMany({
    where: {
      workspaceId,
      ...(opts.leftSince ? { leftAt: { gte: opts.leftSince } } : {}),
      ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
      ...(opts.approverId ? { approverId: opts.approverId } : {}),
      user: { workspaceMembers: { none: { workspaceId } } },
    },
    include: { user: { select: { id: true, name: true, email: true, avatar: true, createdAt: true } } },
  })
  return rows.map((row) => ({ ...asMemberAsOf(row), leftAt: row.leftAt, user: row.user }))
}

/** userId → leftAt for the people among `userIds` who left this workspace (and are not members again). */
export async function formerLeftAtOf(workspaceId: string, userIds: string[]): Promise<Map<string, Date>> {
  const ids = [...new Set(userIds)]
  if (!ids.length) return new Map()
  const rows = await prisma.formerMember.findMany({
    where: { workspaceId, userId: { in: ids }, user: { workspaceMembers: { none: { workspaceId } } } },
    select: { userId: true, leftAt: true },
  })
  return new Map(rows.map((r) => [r.userId, r.leftAt]))
}
