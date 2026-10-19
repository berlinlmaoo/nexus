import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { CHAT_MESSAGE_INCLUDE, chatFileCarrierFor, conversationAccess, canPostInConversation, uploadedChatFile } from "@/lib/chat-access"
import { emitConversationUpdated, emitMessageCreated } from "@/lib/socket-emitter"
import { fanOutChatMessage, runAfterResponse } from "@/lib/chat-fanout"
import { checkRateLimitByKey } from "@/lib/rate-limit"
import { advanceLastReadAt, lockConversationClock, chatRaceResponse } from "@/lib/chat-order"
import {
  CHAT_FILE_PREFIX,
  CHAT_STORED_NAME,
  cleanFileName,
  clientDrawsChatFiles,
  docSpecOfPath,
  shapeMessageForOldApp,
} from "@/lib/chat-files"
import { stat } from "fs/promises"
import path from "path"
import {
  aroundSplit,
  canReplyTo,
  newerThan,
  olderThan,
  parseBefore,
  parseLimit,
  shapeAroundPage,
  shapePage,
  SYSTEM_MESSAGE_REPLY,
  SYSTEM_MESSAGE_REPLY_MESSAGE,
} from "@/lib/chat-rules"

const messageInclude = CHAT_MESSAGE_INCLUDE

/**
 * Documents (18 Oct 2026): an app that only knows pictures gets a document's message without its path
 * and with its name in the text (chat-files.ts shapeForOldApp). The web and apps sending
 * `X-Nexus-Caps: chat-files` get it as stored.
 */
function forClient<P extends { messages: Parameters<typeof shapeMessageForOldApp>[0][] }>(req: NextRequest, page: P): P {
  if (clientDrawsChatFiles(req.headers.get("x-nexus-client"), req.headers.get("x-nexus-caps"))) return page
  return { ...page, messages: page.messages.map((m) => shapeMessageForOldApp(m)) }
}

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
 *   around=<messageId>  a page centred on that message (8 Oct 2026: a search result or a reply quote
 *                       jumps there). Same keys, plus `hasMoreNewer` and `newerCursor` (the id of the
 *                       newest message shown: pass it as `after`) and `anchorId`. `nextCursor` / `hasMore`
 *                       still mean "older", as `before` pages them.
 *
 * Every response carries `hasMore` and `nextCursor` (null when there is nothing older, and always null
 * for `after`): the web tells a server that pages this way by the key being present.
 *
 * Each message carries `kind` ("USER" | "SYSTEM") and `event` (SYSTEM only): a SYSTEM row is a group's
 * log line ("Budi added Mira"), drawn as a centred pill by clients that know it and as a plain message
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
    const aroundId = sp.get("around")
    const before = parseBefore(sp.get("before"))

    if (aroundId) {
      if (afterId || before.kind !== "none") {
        return NextResponse.json({ error: "Use around on its own, without before or after", code: "BAD_CURSOR" }, { status: 400 })
      }
      const anchor = await prisma.message.findFirst({
        where: { id: aroundId, conversationId },
        include: messageInclude,
      })
      if (!anchor) {
        return NextResponse.json({ error: "around is not a message of this conversation", code: "UNKNOWN_MESSAGE" }, { status: 400 })
      }
      const split = aroundSplit(limit)
      const [older, newer] = await Promise.all([
        prisma.message.findMany({
          where: { conversationId, ...olderThan(anchor.createdAt, anchor.id) },
          include: messageInclude,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: split.older + 1,
        }),
        prisma.message.findMany({
          where: { conversationId, ...newerThan(anchor.createdAt, anchor.id) },
          include: messageInclude,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: split.newer + 1,
        }),
      ])
      return NextResponse.json(forClient(req, shapeAroundPage(older, anchor, newer, split)))
    }

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
      return NextResponse.json(forClient(req, shapePage(rows, limit, "newer")))
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
    return NextResponse.json(forClient(req, shapePage(rows, limit, "older")))
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
    if (access.convo && !(await canPostInConversation(userId, access.convo))) {
      return NextResponse.json({ error: "You can view this project but not post in it.", code: "NEEDS_COMMENT_ACCESS" }, { status: 403 })
    }

    const { content, mentionedUserIds, attachmentUrl, attachmentType, attachmentName, replyToId } = await req.json()
    const text = typeof content === "string" ? content.trim() : ""
    // Only accept an attachment path this server itself handed out. Taking an arbitrary URL here
    // would turn every message into an open redirect and let anyone point the chat at a remote host.
    const attachment = typeof attachmentUrl === "string" && attachmentUrl.startsWith(CHAT_FILE_PREFIX)
      ? attachmentUrl
      : null
    // A picture on its own is a message; text is only required when there is nothing else.
    if (!text && !attachment) return NextResponse.json({ error: "content required" }, { status: 400 })

    // The file must be one the sender may load: they uploaded it, or it is already in a room they can
    // read (sent again). Otherwise posting someone else's picture URL into your own DM would make it a
    // message of yours and open the file to you (/api/files follows the messages that carry it).
    if (attachment && !(await uploadedChatFile(userId, attachment)) && !(await chatFileCarrierFor(userId, attachment))) {
      return NextResponse.json({ error: "That file is not on the server. Upload it again.", code: "UNKNOWN_ATTACHMENT" }, { status: 400 })
    }

    // A document (18 Oct 2026): its type comes from the stored file's extension, never from the client;
    // its size from the disk, and it must be a file the upload route really wrote. Its name is the one
    // the sender gave it (cleaned). A picture is taken exactly as before.
    let fileFields: { attachmentType: string; attachmentName: string; attachmentSize: number } | null = null
    const doc = docSpecOfPath(attachment)
    if (attachment && doc) {
      const stored = attachment.slice(CHAT_FILE_PREFIX.length)
      const size = CHAT_STORED_NAME.test(stored)
        ? await stat(path.join(process.cwd(), "public", "uploads", "chat", stored)).then((s) => (s.isFile() ? s.size : null), () => null)
        : null
      if (size === null) return NextResponse.json({ error: "That file is not on the server. Upload it again.", code: "UNKNOWN_ATTACHMENT" }, { status: 400 })
      fileFields = {
        attachmentType: doc.mime,
        attachmentName: cleanFileName(typeof attachmentName === "string" ? attachmentName : "", doc.ext),
        attachmentSize: size,
      }
    }

    // A reply may only quote a message from this same conversation. Without the check, a crafted
    // replyToId would pull a preview out of a chat the reader has no access to.
    let quotedId: string | null = null
    if (typeof replyToId === "string" && replyToId) {
      const quoted = await prisma.message.findFirst({
        where: { id: replyToId, conversationId },
        select: { id: true, kind: true },
      })
      if (!quoted) return NextResponse.json({ error: "replyToId is not in this conversation" }, { status: 400 })
      // A system line ("Budi added Mira") is not something to answer. Apps that don't know `kind` yet
      // offer Reply on it anyway, and show this sentence as it is.
      if (!canReplyTo(quoted)) {
        return NextResponse.json({ error: SYSTEM_MESSAGE_REPLY_MESSAGE, code: SYSTEM_MESSAGE_REPLY }, { status: 400 })
      }
      quotedId = quoted.id
    }

    // Stamped under the room's lock, strictly after the newest message (lib/chat-order.ts, race audit M17):
    // an `after=` poll can no longer step over a message that commits later.
    const message = await prisma.$transaction(async (tx) => {
      const createdAt = await lockConversationClock(tx, conversationId)
      const row = await tx.message.create({
        data: {
          conversationId,
          userId,
          content: text,
          attachmentUrl: attachment,
          attachmentType: fileFields?.attachmentType ?? (attachment && typeof attachmentType === "string" ? attachmentType.slice(0, 64) : null),
          attachmentName: fileFields?.attachmentName ?? null,
          attachmentSize: fileFields?.attachmentSize ?? null,
          replyToId: quotedId,
          createdAt,
        },
        include: messageInclude,
      })
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: createdAt } })
      return row
    }, { timeout: 15_000, maxWait: 10_000 })
    // Writing in a room means you have seen it: your read position moves to your own message — never back
    // (GREATEST in SQL, race audit M18).
    if (access.member) await advanceLastReadAt(prisma, access.member.id, message.createdAt)

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

    return NextResponse.json({ message: forClient(req, { messages: [message] }).messages[0] }, { status: 201 })
  } catch (error) {
    const race = chatRaceResponse(error)
    if (race) return NextResponse.json(race.body, { status: race.status })
    console.error("messages POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
