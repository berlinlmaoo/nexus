import type { Prisma } from "@/generated/prisma/client"

/**
 * Chat message order (race audit 16 Oct 2026, M17).
 *
 * Phones poll a thread with `after=<id of the last message they have>`, which returns the rows strictly
 * after that one in (createdAt, id) order. createdAt used to be the time the INSERT was built, so two sends
 * in the same room could commit in the opposite order of their createdAt: a poll that landed between the
 * two commits saw the later message, moved its cursor past it, and never saw the earlier one (measured on
 * dev: 1 of 29 simultaneous sends skipped by a fast poller).
 *
 * Now every message of a conversation is written inside a transaction that first locks the conversation
 * row (SELECT … FOR UPDATE) and takes createdAt = max(now, newest message + 1 ms). The lock is held until
 * commit, so the next writer of the room waits for this commit and stamps after it: per room, createdAt is
 * strictly increasing in commit order, and a cursor can no longer step over a row that commits later.
 * Different rooms never wait for each other.
 *
 * Lock order: the Conversation row, then the message insert. Nothing else is locked in that transaction
 * (the sender's lastReadAt moves after the commit, with GREATEST), so it cannot deadlock with the
 * membership routes, which lock member rows and then write their system line through here.
 */
export async function lockConversationClock(tx: Prisma.TransactionClient, conversationId: string): Promise<Date> {
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`
  const rows = await tx.$queryRaw<{ ms: number | null }[]>`
    SELECT (EXTRACT(EPOCH FROM MAX("createdAt")) * 1000)::float8 AS ms FROM "Message" WHERE "conversationId" = ${conversationId}`
  const newest = rows[0]?.ms ?? null
  const now = Date.now()
  return new Date(newest !== null && newest >= now ? Math.floor(newest) + 1 : now)
}

/**
 * Move a member's read position to `at`, never backwards (race audit M18). The old code read lastReadAt,
 * took the later of the two in JS and wrote it back, so a late "read up to an older message" from another
 * device, landing between another request's read and write, moved it back (dev: 36 of 40 simultaneous
 * pairs). GREATEST in the UPDATE itself decides against the row as it is at write time.
 * Returns the stored value.
 */
export async function advanceLastReadAt(client: Prisma.TransactionClient, memberId: string, at: Date): Promise<Date> {
  const iso = at.toISOString()
  const rows = await client.$queryRaw<{ ms: number | null }[]>`
    UPDATE "ConversationMember"
       SET "lastReadAt" = GREATEST(COALESCE("lastReadAt", ${iso}::timestamp(3)), ${iso}::timestamp(3))
     WHERE id = ${memberId}
     RETURNING (EXTRACT(EPOCH FROM "lastReadAt") * 1000)::float8 AS ms`
  const ms = rows[0]?.ms
  return typeof ms === "number" ? new Date(Math.round(ms)) : at
}

/**
 * A chat write that lost a race with the group being deleted (QA final 19 Oct 2026: a group deleted while
 * 8 messages, a rename and a removal were in flight answered 8 x 500). The room is gone (foreign key / not
 * found) -> 404; Postgres broke a lock cycle with the delete (40P01) -> 409 RETRY, nothing was written.
 * Anything else -> null (the route's own 500).
 */
export function chatRaceResponse(error: unknown): { status: 404 | 409; body: { error: string; code: string } } | null {
  const e = error as { code?: unknown; message?: unknown; cause?: { originalCode?: unknown; code?: unknown } } | null
  const code = typeof e?.code === "string" ? e.code : ""
  const text = `${typeof e?.message === "string" ? e.message : ""} ${String(e?.cause?.originalCode ?? e?.cause?.code ?? "")}`
  if (code === "P2003" || code === "P2025" || /Message_conversationId_fkey|ConversationMember_conversationId_fkey/.test(text)) {
    return { status: 404, body: { error: "This chat no longer exists.", code: "CONVERSATION_GONE" } }
  }
  if (code === "40P01" || /40P01|deadlock detected/.test(text)) {
    return { status: 409, body: { error: "The chat changed at the same moment. Try again.", code: "RETRY" } }
  }
  return null
}
