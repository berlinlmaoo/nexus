import prisma from '@/lib/prisma'

/**
 * The identity project automations sign their own writes with (owner via coordinator, 12 Oct 2026):
 * comments, tasks, activity and audit rows an automation makes say "Automation" (⚡ avatar), not the
 * person who happened to trigger it. Who triggered it (or, for the clock and webhooks, who made the
 * rule) is kept in the run log (AutomationRun.actorId) and as `triggeredBy` metadata.
 *
 * Same pattern as GIDEON (lib/gideon-identity.ts):
 *  - NO workspace or project membership, so rosters, pickers, leaderboards, reports, attendance and team
 *    lists (which all read the membership tables) never show it;
 *  - `password` null and an `.invalid` address (RFC 2606: can never be a real mailbox, Google account or
 *    IdP NameID), so no sign-in path (password, Google, SAML, passkey, reset mail) can ever reach it;
 *  - a plain User row with name + email + avatar filled, so every released iOS/Android decoder of a
 *    comment/task/activity author finds the fields it expects.
 */
export const AUTOMATION_EMAIL = 'automation@nexus.invalid'
export const AUTOMATION_NAME = 'Automation'
/** Served by /api/system-avatars/[name] (a PNG: the apps cannot draw SVG avatars). */
export const AUTOMATION_AVATAR = '/api/system-avatars/automation.png'

let cached: string | null = null

/** Found or created on first use. */
export async function getAutomationUserId(): Promise<string> {
  if (cached) return cached
  const existing = await prisma.user.findUnique({ where: { email: AUTOMATION_EMAIL }, select: { id: true, avatar: true } })
  if (existing) {
    if (existing.avatar !== AUTOMATION_AVATAR) {
      await prisma.user.update({ where: { id: existing.id }, data: { avatar: AUTOMATION_AVATAR } }).catch(() => {})
    }
    cached = existing.id
    return existing.id
  }
  try {
    const created = await prisma.user.create({
      data: { email: AUTOMATION_EMAIL, name: AUTOMATION_NAME, avatar: AUTOMATION_AVATAR },
      select: { id: true },
    })
    cached = created.id
    return created.id
  } catch {
    // Two first runs at once: the other one created it.
    const again = await prisma.user.findUnique({ where: { email: AUTOMATION_EMAIL }, select: { id: true } })
    if (!again) throw new Error('Automation user could not be created')
    cached = again.id
    return again.id
  }
}
