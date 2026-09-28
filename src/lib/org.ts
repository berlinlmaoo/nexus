import prisma from "@/lib/prisma"
import type { WorkspaceRole } from "@/generated/prisma/client"
import { WORKSPACE_HIERARCHY } from "@/lib/rbac"

// The company workspace. Anyone can sign up and becomes ONE_ABOVE_ALL of their own personal
// workspace, so a role in "any workspace" must never grant company-level power. Company-wide
// powers (feed, admin, NAS, buffer, XP, announcements...) are decided by the role HERE only.
export const ORG_WORKSPACE_ID = process.env.NEXUS_ORG_WORKSPACE_ID?.trim() || "cmmroq7dk0001vewe92nk1g0w"

/** The user's role in the company workspace, or null when they are not a member of it. */
export async function orgRoleOf(userId: string): Promise<WorkspaceRole | null> {
  const m = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: ORG_WORKSPACE_ID } },
    select: { role: true },
  })
  return m?.role ?? null
}

/**
 * May `callerId` change fields of `targetUserId`'s GLOBAL account (password, name, email, phone,
 * avatar)? The account is shared by every workspace the target is in, so outranking the target in
 * ONE workspace (e.g. one the caller created and invited them into) is not enough: the caller must
 * strictly outrank them in EVERY workspace they belong to. ONE_ABOVE_ALL outranks anyone, including
 * another ONE_ABOVE_ALL. System admins are only writable by themselves.
 */
export async function canWriteGlobalAccount(callerId: string, targetUserId: string): Promise<boolean> {
  if (callerId === targetUserId) return true
  const [caller, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: callerId }, select: { role: true } }),
    prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } }),
  ])
  if (caller?.role === "ADMIN") return true
  if (!caller || !target || target.role === "ADMIN") return false

  const [targetMemberships, callerMemberships] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { userId: targetUserId }, select: { workspaceId: true, role: true } }),
    prisma.workspaceMember.findMany({ where: { userId: callerId }, select: { workspaceId: true, role: true } }),
  ])
  if (targetMemberships.length === 0) return false
  const callerRoleIn = new Map(callerMemberships.map((m) => [m.workspaceId, m.role] as const))
  return targetMemberships.every((t) => {
    const mine = callerRoleIn.get(t.workspaceId)
    if (!mine) return false
    if (mine === "ONE_ABOVE_ALL") return true
    return WORKSPACE_HIERARCHY[mine] > WORKSPACE_HIERARCHY[t.role]
  })
}

/**
 * Guard for adding / changing / removing someone's membership of `workspaceId` from the admin screens.
 * Returns an error message (403) or null when allowed. A system admin may do anything. Otherwise the
 * caller must be BoD or above IN THAT WORKSPACE (a company role does not reach other workspaces and a
 * personal-workspace role does not reach the company), may only touch memberships strictly below their
 * own tier there and only grant roles strictly below it (One Above All may do anything), and may never
 * raise their own role.
 */
export async function membershipChangeError(
  callerId: string,
  isSystemAdmin: boolean,
  workspaceId: string,
  change: { targetUserId: string; currentRole?: WorkspaceRole | null; newRole?: WorkspaceRole | null },
): Promise<string | null> {
  const { targetUserId, currentRole, newRole } = change
  if (targetUserId === callerId && newRole && currentRole && WORKSPACE_HIERARCHY[newRole] > WORKSPACE_HIERARCHY[currentRole]) {
    return "Kamu tidak bisa menaikkan peran kamu sendiri."
  }
  if (isSystemAdmin) return null
  const mine = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: callerId, workspaceId } },
    select: { role: true },
  })
  if (!mine || WORKSPACE_HIERARCHY[mine.role] < WORKSPACE_HIERARCHY.BOD) {
    return "Hanya BoD ke atas di workspace ini yang bisa mengatur keanggotaannya."
  }
  if (mine.role === "ONE_ABOVE_ALL") return null
  const myTier = WORKSPACE_HIERARCHY[mine.role]
  if (currentRole && targetUserId !== callerId && WORKSPACE_HIERARCHY[currentRole] >= myTier) {
    return "Kamu tidak bisa mengubah anggota yang setara atau di atas level kamu."
  }
  if (newRole && WORKSPACE_HIERARCHY[newRole] >= myTier) {
    return "Kamu hanya bisa memberi peran di bawah level kamu."
  }
  return null
}

/** System admin, or BoD / One Above All of the company workspace. */
export async function isAdminOrOrgBodPlus(userId: string): Promise<boolean> {
  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    orgRoleOf(userId),
  ])
  return user?.role === "ADMIN" || role === "BOD" || role === "ONE_ABOVE_ALL"
}

/** System admin, or a member (any role) of the company workspace. */
export async function isAdminOrOrgMember(userId: string): Promise<boolean> {
  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    orgRoleOf(userId),
  ])
  return user?.role === "ADMIN" || role !== null
}
