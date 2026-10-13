import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { orgRoleOf } from "@/lib/org"
import { invitePowerOf, parseRootEmails, type InvitePower } from "@/lib/legal/rules"

// Legal is invitation-only (owner, 14 Oct 2026). This is the ONE place that answers "may this person use
// Legal"; every /api/legal route asks it through legalGate(), and the clients' nav flag
// (GET /api/workspaces/members → canAccessLegal) asks hasLegalAccess(). The rule itself: rules.ts.

/** Who always has Legal. Env override for the dev server's test accounts; the owner by default. */
export const LEGAL_ROOT_EMAILS = parseRootEmails(process.env.LEGAL_ROOT_EMAILS)

export type LegalActor = {
  userId: string
  name: string
  email: string
  isRoot: boolean
  /** Role in the company workspace; null only for a root who is not in it. */
  orgRole: string | null
  power: InvitePower
}

export function isLegalRootEmail(email: string | null | undefined): boolean {
  return !!email && LEGAL_ROOT_EMAILS.includes(email.toLowerCase())
}

/** The person as Legal sees them, or null when they have no Legal access. Someone who left the company
 *  loses Legal with it, invitation or not; the root keeps it. */
export async function legalActor(userId: string): Promise<LegalActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, deactivatedAt: true,
      legalMembership: { select: { revokedAt: true, invitedBy: { select: { email: true } } } },
    },
  })
  if (!user || user.deactivatedAt) return null
  const isRoot = isLegalRootEmail(user.email)
  const isMember = !!user.legalMembership && !user.legalMembership.revokedAt
  if (!isRoot && !isMember) return null
  const orgRole = await orgRoleOf(userId)
  if (!isRoot && !orgRole) return null
  const invitedByRoot = isLegalRootEmail(user.legalMembership?.invitedBy?.email)
  return { userId: user.id, name: user.name, email: user.email, isRoot, orgRole, power: invitePowerOf({ isRoot, isMember, orgRole, invitedByRoot }) }
}

export async function hasLegalAccess(userId: string): Promise<boolean> {
  return (await legalActor(userId)) !== null
}

export type LegalGate = { ok: true; actor: LegalActor } | { ok: false; response: NextResponse }

/** First line of every /api/legal route: signed in, and invited (or the root). */
export async function legalGate(): Promise<LegalGate> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const actor = await legalActor(session.user.id)
  if (!actor) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Legal is available by invitation only", code: "LEGAL_NOT_INVITED" }, { status: 403 }),
    }
  }
  return { ok: true, actor }
}

/** Company details, kops and numbering formats are changed only by those who may invite (the owner and the
 *  BoD members he invited): a wrong format or kop lands on every document after it. */
export function settingsForbidden(actor: LegalActor): NextResponse | null {
  if (actor.power !== "NONE") return null
  return NextResponse.json({ error: "Only the owner or a BoD member with Legal can change Legal settings" }, { status: 403 })
}
