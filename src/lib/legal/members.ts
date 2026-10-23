import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { SYSTEM_USER_EMAILS } from "@/lib/system-users"
import { LEGAL_ROOT_EMAILS, isLegalRootEmail, type LegalActor } from "@/lib/legal/access"
import { isBoardRole, mayInvite, mayRevoke } from "@/lib/legal/rules"

// Who has Legal, and inviting / revoking (owner, 14 Oct 2026). Every invite and revoke is also an audit
// row (the routes write it); the LegalMember row keeps the latest inviter and revoker.

const person = { select: { id: true, name: true, avatar: true } } as const

export class LegalMemberError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

async function orgRolesOf(userIds: string[]): Promise<Map<string, string>> {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId: ORG_WORKSPACE_ID, userId: { in: userIds } },
    select: { userId: true, role: true },
  })
  return new Map(rows.map((r) => [r.userId, r.role]))
}

export type LegalMemberRow = {
  userId: string
  name: string
  email: string
  avatar: string | null
  orgRole: string | null
  isRoot: boolean
  active: boolean
  invitedAt: string | null
  invitedBy: { id: string; name: string; avatar: string | null } | null
  revokedAt: string | null
  revokedBy: { id: string; name: string; avatar: string | null } | null
  /** May the viewer revoke this person (root: anyone; BoD: the people they invited). */
  canRevoke: boolean
  /** May this person invite others: "ANY" (root), "STAFF" (BoD/One Above All), "NONE". */
  invitePower: "ANY" | "STAFF" | "NONE"
}

/** The root(s) first, then active members, then revoked ones (kept for the record). */
export async function listLegalMembers(viewer: LegalActor): Promise<LegalMemberRow[]> {
  const [roots, rows] = await Promise.all([
    prisma.user.findMany({
      where: { email: { in: LEGAL_ROOT_EMAILS, mode: "insensitive" }, deactivatedAt: null },
      select: { id: true, name: true, email: true, avatar: true },
    }),
    prisma.legalMember.findMany({
      orderBy: [{ invitedAt: "asc" }],
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true, deactivatedAt: true } },
        invitedBy: { select: { id: true, name: true, avatar: true, email: true } },
        revokedBy: person,
      },
    }),
  ])
  const roles = await orgRolesOf([...roots.map((r) => r.id), ...rows.map((r) => r.userId)])
  const rootIds = new Set(roots.map((r) => r.id))

  const out: LegalMemberRow[] = roots.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    orgRole: roles.get(u.id) ?? null,
    isRoot: true,
    active: true,
    invitedAt: null,
    invitedBy: null,
    revokedAt: null,
    revokedBy: null,
    canRevoke: false,
    invitePower: "ANY",
  }))
  for (const m of rows) {
    if (rootIds.has(m.userId)) continue
    const orgRole = roles.get(m.userId) ?? null
    // Same rule as legalActor: left the company or offboarded = no Legal, whatever the row says.
    const active = !m.revokedAt && !m.user.deactivatedAt && !!orgRole
    out.push({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      avatar: m.user.avatar,
      orgRole,
      isRoot: false,
      active,
      invitedAt: m.invitedAt.toISOString(),
      invitedBy: m.invitedBy ? { id: m.invitedBy.id, name: m.invitedBy.name, avatar: m.invitedBy.avatar } : null,
      revokedAt: m.revokedAt?.toISOString() ?? null,
      revokedBy: m.revokedBy,
      canRevoke: !m.revokedAt && mayRevoke(viewer, m.invitedById),
      invitePower: active && isBoardRole(orgRole) && isLegalRootEmail(m.invitedBy?.email) ? "STAFF" : "NONE",
    })
  }
  out.sort((a, b) => Number(b.isRoot) - Number(a.isRoot) || Number(b.active) - Number(a.active))
  return out
}

/** Company members the viewer may invite and who don't have Legal yet, optionally filtered by name/email. */
export async function legalInviteCandidates(viewer: LegalActor, q: string) {
  if (viewer.power === "NONE") return []
  const needle = q.trim()
  const rows = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: ORG_WORKSPACE_ID,
      user: {
        deactivatedAt: null,
        email: { notIn: [...SYSTEM_USER_EMAILS, ...LEGAL_ROOT_EMAILS] },
        OR: [{ legalMembership: null }, { legalMembership: { revokedAt: { not: null } } }],
        ...(needle
          ? { AND: [{ OR: [{ name: { contains: needle, mode: "insensitive" } }, { email: { contains: needle, mode: "insensitive" } }] }] }
          : {}),
      },
    },
    select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
    orderBy: { user: { name: "asc" } },
    take: 50,
  })
  return rows
    .filter((r) => mayInvite(viewer.power, r.role))
    .map((r) => ({ userId: r.user.id, name: r.user.name, email: r.user.email, avatar: r.user.avatar, orgRole: r.role }))
}

/** Grant Legal. Re-inviting a revoked person reactivates their row with the new inviter. */
export async function inviteLegalMember(viewer: LegalActor, targetUserId: string) {
  if (viewer.power === "NONE") throw new LegalMemberError("You can't invite people to Legal", 403)
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true, deactivatedAt: true, legalMembership: { select: { revokedAt: true } } },
  })
  if (!target || target.deactivatedAt || SYSTEM_USER_EMAILS.includes(target.email.toLowerCase())) {
    throw new LegalMemberError("User not found", 404)
  }
  if (isLegalRootEmail(target.email)) throw new LegalMemberError("This person already has Legal")
  if (target.legalMembership && !target.legalMembership.revokedAt) throw new LegalMemberError("This person already has Legal")
  const targetRole = (await orgRolesOf([target.id])).get(target.id) ?? null
  if (!targetRole) throw new LegalMemberError("Only people of the company can be invited")
  if (!mayInvite(viewer.power, targetRole)) {
    throw new LegalMemberError("Only the owner can invite BoD or One Above All members", 403)
  }
  const now = new Date()
  await prisma.legalMember.upsert({
    where: { userId: target.id },
    create: { userId: target.id, invitedById: viewer.userId, invitedAt: now },
    update: { invitedById: viewer.userId, invitedAt: now, revokedAt: null, revokedById: null },
  })
  return { userId: target.id, name: target.name, orgRole: targetRole, reinvited: !!target.legalMembership }
}

export async function revokeLegalMember(viewer: LegalActor, targetUserId: string) {
  const row = await prisma.legalMember.findUnique({
    where: { userId: targetUserId },
    select: { invitedById: true, revokedAt: true, user: { select: { name: true } } },
  })
  if (!row || row.revokedAt) throw new LegalMemberError("This person has no Legal access", 404)
  if (!mayRevoke(viewer, row.invitedById)) {
    throw new LegalMemberError("You can only remove people you invited", 403)
  }
  // Only the request that actually flips the row wins: a second tap (or a second admin) at the same moment
  // gets the same 404 as a later one, so one removal leaves one audit row and keeps the first revokedAt.
  const flipped = await prisma.legalMember.updateMany({
    where: { userId: targetUserId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: viewer.userId },
  })
  if (flipped.count === 0) throw new LegalMemberError("This person has no Legal access", 404)
  return { userId: targetUserId, name: row.user.name, invitedById: row.invitedById }
}
