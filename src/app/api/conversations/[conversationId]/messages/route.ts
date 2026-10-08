import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { CHAT_MESSAGE_INCLUDE, conversationAccess } from "@/lib/chat-access"
import { emitConversationUpdated, emitMessageCreated } from "@/lib/socket-emitter"
import { fanOutChatMessage, runAfterResponse } from "@/lib/chat-fanout"
import { checkRateLimitByKey } from "@/lib/rate-limit"
import {
  canReplyTo,
  newerThan,
  olderThan,
  parseBefore,
  parseLimit,
  shapePage,
  nextLastReadAt,
  SYSTEM_MESSAGE_REPLY,
  SYSTEM_MESSAGE_REPLY_MESSAGE,
} from "@/lib/chat-rules"

const messageInclude = CHAT_MESSAGE_INCLUDE

/** CHAT-CONTRACT: at most 30 messages a minute per person (a stuck retry loop, a script, a flood). */
const SEND_LIMIT = { limit: 30, windowSeconds: 60 }

/**
 * A page of messages, oldest first.
 *
 *   (no cursor)         the newest `limit` (default 50, max 100).
 *   before=<cursor>     older than that message — the `nextCursor` of the previous page.
 *   before=<ISO date>   older than that instant, as every client sent until 8 Oct 2026.
 *   after=<messageId>   strictly newer than that message, oldest first — what phones poll with.
 *                       An empty array means nothing new; `hasMore` means poll again straight away.
 *
 * Every response carries `hasMore` and `nextCursor` (null when there is nothing older, and always null
 * for `after`): the web tells a server that pages this way by the key being present.
 *
 * Each message carries `kind` ("USER" | "SYSTEM") and `event` (SYSTEM only): a SYSTEM row is a group's
 * log line ("Bagas added Mey"), drawn as a centred pill by clients that know it and as a plain message
 * with an Indonesian `content` by those that don't (chat-system.ts).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { conversationId } = await params
    const access = await conversationAccess(session.user.id, conversationId)
    if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status })

    const sp = req.nextUrl.searchParams
    const limit = parseLimit(sp.get("limit"))
    const afterId = sp.get("after")
    const before = parseBefore(sp.get("before"))

    if (afterId) {
      if (before.kind !== "none") {
        return NextResponse.json({ error: "Use either before or after, not both", code: "BAD_CURSOR" }, { status: 400 })
      }
      const anchor = await prisma.message.findFirst({
        where: { id: afterId, conversationId },
        select: { id: true, createdAt: true },
      })
      if (!anchor) {
        return NextResponse.json({ error: "after is not a message of this conversation", code: "UNKNOWN_MESSAGE" }, { status: 400 })
      }
      const rows = await prisma.message.findMany({
        where: { conversationId, ...newerThan(anchor.createdAt, anchor.id) },
        include: messageInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
      })
      return NextResponse.json(shapePage(rows, limit, "newer"))
    }

    if (before.kind === "invalid") {
      return NextResponse.json({ error: "before must be a cursor or an ISO date", code: "BAD_CURSOR" }, { status: 400 })
    }
    const where =
      before.kind === "cursor" ? { conversationId, ...olderThan(before.createdAt, before.id) }
      : before.kind === "date" ? { conversationId, createdAt: { lt: before.date } }
      : { conversationId }
    const rows = await prisma.message.findMany({
      where,
      include: messageInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    })
    return NextResponse.json(shapePage(rows, limit, "older"))
  } catch (error) {
    console.error("messages GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params

    const rate = checkRateLimitByKey("chat-send", userId, SEND_LIMIT)
    if (!rate.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))
      return NextResponse.json(
        { error: "Terlalu banyak pesan dalam satu menit. Tunggu sebentar, lalu kirim lagi.", code: "RATE_LIMITED", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      )
    }

    const access = await conversationAccess(userId, conversationId)
    if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status })

    const { content, mentionedUserIds, attachmentUrl, attachmentType, replyToId } = await req.json()
    const text = typeof content === "string" ? content.trim() : ""
    // Only accept an attachment path this server itself handed out. Taking an arbitrary URL here
    // would turn every message into an open redirect and let anyone point the chat at a remote host.
    const attachment = typeof attachmentUrl === "string" && attachmentUrl.startsWith("/api/files/chat/")
      ? attachmentUrl
      : null
    // A picture on its own is a message; text is only required when there is nothing else.
    if (!text && !attachment) return NextResponse.json({ error: "content required" }, { status: 400 })

    // A reply may only quote a message from this same conversation. Without the check, a crafted
    // replyToId would pull a preview out of a chat the reader has no access to.
    let quotedId: string | null = null
    if (typeof replyToId === "string" && replyToId) {
      const quoted = await prisma.message.findFirst({
        where: { id: replyToId, conversationId },
        select: { id: true, kind: true },
      })
      if (!quoted) return NextResponse.json({ error: "replyToId is not in this conversation" }, { status: 400 })
      // A system line ("Bagas added Mey") is not something to answer. Apps that don't know `kind` yet
      // offer Reply on it anyway, and show this sentence as it is.
      if (!canReplyTo(quoted)) {
        return NextResponse.json({ error: SYSTEM_MESSAGE_REPLY_MESSAGE, code: SYSTEM_MESSAGE_REPLY }, { status: 400 })
      }
      quotedId = quoted.id
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        userId,
        content: text,
        attachmentUrl: attachment,
        attachmentType: attachment && typeof attachmentType === "string" ? attachmentType.slice(0, 64) : null,
        replyToId: quotedId,
      },
      include: messageInclude,
    })
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
    // Writing in a room means you have seen it: your read position moves to your own message.
    if (access.member) {
      await prisma.conversationMember.update({
        where: { id: access.member.id },
        data: { lastReadAt: nextLastReadAt(access.member.lastReadAt, message.createdAt) },
      })
    }

    const memberIds = (
      await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })
    ).map((m) => m.userId)
    emitMessageCreated(conversationId, message as unknown as Record<string, unknown>, memberIds)
    emitConversationUpdated(memberIds, { conversationId, lastMessageAt: message.createdAt.toISOString(), reason: "message" })

    // Push (and the Inbox row for a mention) after the reply is on its way — chat-fanout.ts.
    runAfterResponse("chat fan-out", () => fanOutChatMessage({
      conversationId,
      message,
      senderId: userId,
      mentionedUserIds,
      rawContent: content,
    }))

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error("messages POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
