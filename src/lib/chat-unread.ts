import prisma from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { conversationIdFromLink, summarizeUnread, UNREAD_CAP, type UnreadRow } from "@/lib/chat-rules"

/**
 * Unread counts for the chat list, the badge endpoint and the push badge.
 *
 * One grouped query instead of one COUNT per conversation (GET /api/conversations did a COUNT per
 * room). Rules, the same everywhere:
 *   - your own messages are never unread;
 *   - SYSTEM lines ("Bagas added Mey", chat-system.ts) are never unread: kind must be USER
 *     (chat-rules countsTowardUnread). The badge, totalUnread and every push's badge come from here;
 *   - unread starts at your read position, or at the moment you joined if you never opened the room —
 *     joining a group does not hand you its whole history as "unread" (a null lastReadAt used to);
 *   - counted up to UNREAD_CAP per room (a badge reads "99+" long before);
 *   - a muted room counts only the mentions waiting in it (chat-rules summarizeUnread). Mentions are the
 *     unread MESSAGE_MENTION Inbox rows for that room — the only place a mention is recorded.
 */

export const CHAT_NOTIFICATION_TYPES = ["MESSAGE", "MESSAGE_MENTION"]

type CountRow = { userId: string; conversationId: string; unread: number }

async function unreadCounts(userIds: string[], conversationIds?: string[]): Promise<CountRow[]> {
  if (userIds.length === 0) return []
  if (conversationIds && conversationIds.length === 0) return []
  const onlyRooms = conversationIds ? Prisma.sql`AND cm."conversationId" IN (${Prisma.join(conversationIds)})` : Prisma.empty
  return prisma.$queryRaw<CountRow[]>`
    SELECT cm."userId" AS "userId", cm."conversationId" AS "conversationId",
      (SELECT COUNT(*) FROM (
         SELECT 1 FROM "Message" m
          WHERE m."conversationId" = cm."conversationId"
            AND m."userId" <> cm."userId"
            AND m."kind" = 'USER'
            AND m."createdAt" > COALESCE(cm."lastReadAt", cm."joinedAt")
          LIMIT ${UNREAD_CAP}
       ) capped)::int AS "unread"
      FROM "ConversationMember" cm
     WHERE cm."userId" IN (${Prisma.join(userIds)}) ${onlyRooms}`
}

/** Unread MESSAGE_MENTION rows per (user, conversation). */
async function mentionCounts(userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (userIds.length === 0) return out
  const rows = await prisma.notification.groupBy({
    by: ["userId", "link"],
    where: { userId: { in: userIds }, read: false, type: "MESSAGE_MENTION" },
    _count: { _all: true },
  })
  for (const r of rows) {
    const c = conversationIdFromLink(r.link)
    if (!c) continue
    const key = `${r.userId}|${c}`
    out.set(key, (out.get(key) ?? 0) + r._count._all)
  }
  return out
}

export type ChatUnread = {
  totalUnread: number
  mentions: number
  /** Per conversation: unread (own messages excluded) and mentions waiting. */
  perConversation: Map<string, { unread: number; mentions: number; muted: boolean }>
}

/** One person's unread, optionally limited to the rooms they can actually see. */
export async function chatUnreadForUser(userId: string, opts: { conversationIds?: string[]; now?: Date } = {}): Promise<ChatUnread> {
  const [counts, mentions, mutes] = await Promise.all([
    unreadCounts([userId], opts.conversationIds),
    mentionCounts([userId]),
    prisma.conversationMember.findMany({
      where: { userId, ...(opts.conversationIds ? { conversationId: { in: opts.conversationIds } } : {}) },
      select: { conversationId: true, mutedUntil: true },
    }),
  ])
  const muteOf = new Map(mutes.map((m) => [m.conversationId, m.mutedUntil]))
  const rows: UnreadRow[] = counts.map((c) => ({
    conversationId: c.conversationId,
    unread: Number(c.unread) || 0,
    mutedUntil: muteOf.get(c.conversationId) ?? null,
    mentions: mentions.get(`${userId}|${c.conversationId}`) ?? 0,
  }))
  const summary = summarizeUnread(rows, opts.now ?? new Date())
  const perConversation = new Map<string, { unread: number; mentions: number; muted: boolean }>()
  for (const r of rows) {
    perConversation.set(r.conversationId, {
      unread: r.unread,
      mentions: Math.min(r.unread, r.mentions ?? 0),
      muted: summary.muted.has(r.conversationId),
    })
  }
  return { totalUnread: summary.totalUnread, mentions: summary.mentions, perConversation }
}

/**
 * The app-icon badge for many people at once (one push fan-out): chat totalUnread (muted rooms count
 * their mentions only) + unread Inbox rows that are not chat (a mention already counts in the chat).
 */
export async function badgeCountsFor(userIds: string[], now: Date = new Date()): Promise<Map<string, number>> {
  const out = new Map<string, number>(userIds.map((id) => [id, 0]))
  if (userIds.length === 0) return out
  const [counts, mentions, mutes, inbox] = await Promise.all([
    unreadCounts(userIds),
    mentionCounts(userIds),
    prisma.conversationMember.findMany({
      where: { userId: { in: userIds }, mutedUntil: { not: null } },
      select: { userId: true, conversationId: true, mutedUntil: true },
    }),
    prisma.notification.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, read: false, type: { notIn: CHAT_NOTIFICATION_TYPES } },
      _count: { _all: true },
    }),
  ])
  const muteOf = new Map(mutes.map((m) => [`${m.userId}|${m.conversationId}`, m.mutedUntil]))
  const perUser = new Map<string, UnreadRow[]>()
  for (const c of counts) {
    const key = `${c.userId}|${c.conversationId}`
    const list = perUser.get(c.userId) ?? []
    list.push({ conversationId: c.conversationId, unread: Number(c.unread) || 0, mutedUntil: muteOf.get(key) ?? null, mentions: mentions.get(key) ?? 0 })
    perUser.set(c.userId, list)
  }
  for (const [userId, rows] of perUser) out.set(userId, summarizeUnread(rows, now).totalUnread)
  for (const r of inbox) out.set(r.userId, (out.get(r.userId) ?? 0) + r._count._all)
  return out
}
