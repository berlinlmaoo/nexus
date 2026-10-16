import prisma from "@/lib/prisma"

/**
 * Who may see a person's PERSONAL attendance data — XP penalties with their dates (late, absent, no
 * check-out), shift hours, per-day shifts, rest days, Flexi / no-geofence flags, approver (owner decision,
 * 13 Oct 2026): the person themself and the people above them. "Above" =
 *   - a BoD or One Above All of the workspace, or
 *   - anyone up their approval chain (WorkspaceMember.approverId, followed to the top — the manager, the
 *     manager's approver, and so on).
 * Fellow Staff (and a Manager who isn't up that chain) see the public things only: name, avatar, role,
 * points and rank.
 *
 * One query for the whole workspace, then `canSee(userId)` answers per person — the members list asks it
 * for every row.
 */
export type PersonalScope = { all: boolean; canSee: (userId: string) => boolean }

export async function personalScope(viewerId: string, workspaceId: string): Promise<PersonalScope> {
  const rows = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true, approverId: true } })
  const me = rows.find((r) => r.userId === viewerId)
  const all = me?.role === "BOD" || me?.role === "ONE_ABOVE_ALL"
  if (all) return { all: true, canSee: () => true }
  const approverOf = new Map(rows.map((r) => [r.userId, r.approverId]))
  const memo = new Map<string, boolean>()
  const canSee = (userId: string): boolean => {
    if (userId === viewerId) return true
    const hit = memo.get(userId)
    if (hit !== undefined) return hit
    let cur = approverOf.get(userId) ?? null
    let ok = false
    // The chain is kept acyclic by PATCH /api/workspaces/members; the hop cap guards old data anyway.
    for (let hops = 0; cur && hops < 25; hops++) {
      if (cur === viewerId) { ok = true; break }
      cur = approverOf.get(cur) ?? null
    }
    memo.set(userId, ok)
    return ok
  }
  return { all: false, canSee }
}

/** True when `viewerId` may see `targetId`'s personal attendance data in a workspace they share. */
export async function canSeePersonalAttendance(viewerId: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId) return true
  const shared = await prisma.workspaceMember.findMany({
    where: { userId: targetId, workspace: { members: { some: { userId: viewerId } } } },
    select: { workspaceId: true },
  })
  for (const s of shared) if ((await personalScope(viewerId, s.workspaceId)).canSee(targetId)) return true
  return false
}
