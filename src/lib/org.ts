import prisma from "@/lib/prisma"
import type { WorkspaceRole } from "@/generated/prisma/client"
import { WORKSPACE_HIERARCHY } from "@/lib/rbac"

// The company workspace. Anyone can sign up and becomes ONE_ABOVE_ALL of their own personal
// workspace, so a role in "any workspace" must never grant company-level power. Company-wide
// powers (feed, admin, NAS, buffer, XP, announcements...) are decided by the role HERE only.
// Its id was "cmmroq7dk0001vewe92nk1g0w" until the UUIDv7 conversion, which pins this new id for it
// (scripts/uuid-migration/uuid-lib.sql, uuid_mig.pin), so prod and dev share it and nothing else needs to change.
export const ORG_WORKSPACE_ID_V7 = "019cf14d-ebd8-7000-b947-67d4138beaf3"
export const ORG_WORKSPACE_ID = process.env.NEXUS_ORG_WORKSPACE_ID?.trim() || ORG_WORKSPACE_ID_V7

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
 * another ONE_ABOVE_ALL. The company's One Above All may write any company member's account, and
 * their own account is writable only by themselves (both were the retired system ADMIN flag's, 16 Oct 2026).
 */
export async function canWriteGlobalAccount(callerId: string, targetUserId: string): Promise<boolean> {
  if (callerId === targetUserId) return true
  const [targetMemberships, callerMemberships] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { userId: targetUserId }, select: { workspaceId: true, role: true } }),
    prisma.workspaceMember.findMany({ where: { userId: callerId }, select: { workspaceId: true, role: true } }),
  ])
  if (targetMemberships.length === 0) return false
  const callerRoleIn = new Map(callerMemberships.map((m) => [m.workspaceId, m.role] as const))
  const targetOrgRole = targetMemberships.find((m) => m.workspaceId === ORG_WORKSPACE_ID)?.role
  if (targetOrgRole === "ONE_ABOVE_ALL") return false
  if (targetOrgRole && callerRoleIn.get(ORG_WORKSPACE_ID) === "ONE_ABOVE_ALL") return true
  return targetMemberships.every((t) => {
    const mine = callerRoleIn.get(t.workspaceId)
    if (!mine) return false
    if (mine === "ONE_ABOVE_ALL") return true
    return WORKSPACE_HIERARCHY[mine] > WORKSPACE_HIERARCHY[t.role]
  })
}

/**
 * Guard for adding / changing / removing someone's membership of `workspaceId` from the admin screens.
 * Returns an error message (403) or null when allowed. The caller must be BoD or above IN THAT WORKSPACE
 * (a company role does not reach other workspaces and a personal-workspace role does not reach the
 * company), may only touch memberships strictly below their
 * own tier there and only grant roles strictly below it (One Above All may do anything), and may never
 * raise their own role.
 */
export async function membershipChangeError(
  callerId: string,
  workspaceId: string,
  change: { targetUserId: string; currentRole?: WorkspaceRole | null; newRole?: WorkspaceRole | null },
): Promise<string | null> {
  const { targetUserId, currentRole, newRole } = change
  if (targetUserId === callerId && newRole && currentRole && WORKSPACE_HIERARCHY[newRole] > WORKSPACE_HIERARCHY[currentRole]) {
    return "Kamu tidak bisa menaikkan peran kamu sendiri."
  }
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

/** BoD / One Above All of the company workspace. */
export async function isOrgBodPlus(userId: string): Promise<boolean> {
  const role = await orgRoleOf(userId)
  return role === "BOD" || role === "ONE_ABOVE_ALL"
}

/** A member (any role) of the company workspace. */
export async function isOrgMember(userId: string): Promise<boolean> {
  return (await orgRoleOf(userId)) !== null
}
