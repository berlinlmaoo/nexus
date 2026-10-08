import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { conversationMemberAccess } from "@/lib/chat-access"
import { CHAT_NOTIFICATION_TYPES } from "@/lib/chat-unread"
import { chatLink, nextLastReadAt } from "@/lib/chat-rules"
import { emitConversationUpdated } from "@/lib/socket-emitter"

/**
 * Mark a conversation read.
 *
 *   {}                          (every client until 8 Oct 2026) — read up to now.
 *   { upToMessageId: "<id>" }   read up to that message: its createdAt becomes lastReadAt. A phone that
 *                               only saw the first 50 of 80 new messages no longer clears all 80.
 *
 * lastReadAt never moves backwards (a late report from another device cannot bring messages back to
 * unread). The chat's Inbox rows (mentions, and the per-message rows written before 8 Oct 2026) are
 * marked read with it, so the bell and the chat agree.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params
    // Only an existing member may mark a conversation read — never auto-join (the old upsert-create let
    // any user add themselves to, and read, any conversation by id).
    const access = await conversationMemberAccess(userId, conversationId)
    if (!access.ok || !access.member) {
      return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.ok ? 403 : access.status })
    }

    // iOS sends no body at all, Android `{}`, the web nothing: all of them mean "up to now".
    const body = await req.json().catch(() => null)
    const upToMessageId = typeof body?.upToMessageId === "string" && body.upToMessageId ? body.upToMessageId : null

    const newest = await prisma.message.findFirst({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, createdAt: true },
    })

    const now = new Date()
    let target = now
    // How far the Inbox rows go: everything when reading to the end, else up to the message (plus the
    // few seconds a mention row is written after its message).
    let inboxCutoff = now
    if (upToMessageId) {
      const upTo = await prisma.message.findFirst({
        where: { id: upToMessageId, conversationId },
        select: { id: true, createdAt: true },
      })
      if (!upTo) {
        return NextResponse.json({ error: "upToMessageId is not a message of this conversation", code: "UNKNOWN_MESSAGE" }, { status: 400 })
      }
      target = upTo.createdAt
      if (!newest || newest.id !== upTo.id) inboxCutoff = new Date(upTo.createdAt.getTime() + 5_000)
    }

    const lastReadAt = nextLastReadAt(access.member.lastReadAt, target)
    await prisma.conversationMember.update({
      where: { id: access.member.id },
      data: { lastReadAt },
    })
    await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
        type: { in: CHAT_NOTIFICATION_TYPES },
        link: chatLink(conversationId),
        createdAt: { lte: inboxCutoff },
      },
      data: { read: true },
    })

    // The caller's other tabs and devices drop the unread dot too.
    emitConversationUpdated([userId], {
      conversationId,
      lastMessageAt: newest ? newest.createdAt.toISOString() : null,
      reason: "read",
    })
    return NextResponse.json({ success: true, lastReadAt: lastReadAt.toISOString() })
  } catch (error) {
    console.error("conversation read error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
