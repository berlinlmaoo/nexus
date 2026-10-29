import type { PrismaClient } from "@/generated/prisma/client"

/**
 * The attendance board (owner, 29 Oct 2026): people who were offboarded (User.deactivatedAt, see
 * lib/offboarding.ts) are hidden from it entirely, whatever range it shows. Only the board — the
 * JSON answer of GET /api/attendance/history?scope=workspace without a userId, which the web board and
 * log, iOS and Android read. Their records stay as they were, and the xlsx/csv exports, a per-person
 * history (userId) and the recaps (lib/former-recaps.ts) still include them.
 */

/** The ids among `userIds` whose account was offboarded. One small query; nothing to ask = no query. */
export async function offboardedUserIdsAmong(
  db: Pick<PrismaClient, "user">,
  userIds: Iterable<string>,
): Promise<Set<string>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return new Set()
  const found = await db.user.findMany({ where: { id: { in: ids }, deactivatedAt: { not: null } }, select: { id: true } })
  return new Set(found.map((u) => u.id))
}

/** `rows` and `roster` without the offboarded people. Returns the same arrays when nobody is hidden. */
export function withoutOffboarded<R extends { user: { id: string } }, M extends { user: { id: string } }>(
  board: { rows: R[]; roster: M[] },
  offboarded: ReadonlySet<string>,
): { rows: R[]; roster: M[] } {
  if (offboarded.size === 0) return board
  return {
    rows: board.rows.filter((r) => !offboarded.has(r.user.id)),
    roster: board.roster.filter((m) => !offboarded.has(m.user.id)),
  }
}
