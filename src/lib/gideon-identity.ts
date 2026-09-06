import prisma from '@/lib/prisma'

/**
 * The identity GIDEON signs its own writes with.
 *
 * Permission and authorship are two different questions, and they were being answered by the same
 * value. GIDEON must act with the REQUESTER's permissions — it can never reach further than the
 * person who asked — but a task, comment or document it produced should say GIDEON produced it. A
 * comment appearing under a colleague's name in a shared thread is a small lie that nobody can spot
 * afterwards.
 */
export const GIDEON_EMAIL = 'gideon@znetworks.id'
const GIDEON_NAME = 'GIDEON'

/**
 * Found or created on first use.
 *
 * Deliberately given NO workspace or project membership. Rosters, leaderboards, assignee pickers and
 * team lists all read the membership tables, so an identity without one is invisible to every screen
 * while still being a valid author. `password` stays null: this exists to be named, never to sign in.
 */
export async function getGideonUserId(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { email: GIDEON_EMAIL },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await prisma.user.create({
    data: { email: GIDEON_EMAIL, name: GIDEON_NAME },
    select: { id: true },
  })
  return created.id
}
