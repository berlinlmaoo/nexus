import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { conversationMemberAccess } from "@/lib/chat-access"
import { parseMutedUntil } from "@/lib/chat-rules"
import { emitConversationUpdated } from "@/lib/socket-emitter"

/**
 * Mute a conversation for yourself.
 *
 *   PATCH { mutedUntil: "<ISO>" | "forever" | null }  →  { mutedUntil: "<ISO>" | null }
 *
 * Muted = no push for plain messages and the room counts only its mentions in totalUnread; an
 * @mention still gets through (chat-rules chatPushDecision). "forever" is stored as 9999-12-31; a time
 * already past is the same as null. Only your own member row changes — nobody else sees who muted.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params

    const access = await conversationMemberAccess(userId, conversationId)
    if (!access.ok || !access.member) {
      return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.ok ? 403 : access.status })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || !("mutedUntil" in body)) {
      return NextResponse.json({ error: 'mutedUntil required (ISO date, "forever" or null)', code: "BAD_MUTE" }, { status: 400 })
    }
    const parsed = parseMutedUntil((body as { mutedUntil: unknown }).mutedUntil)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: "BAD_MUTE" }, { status: 400 })

    const updated = await prisma.conversationMember.update({
      where: { id: access.member.id },
      data: { mutedUntil: parsed.value },
      select: { mutedUntil: true },
    })
    const mutedUntil = updated.mutedUntil ? updated.mutedUntil.toISOString() : null

    const newest = await prisma.message.findFirst({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    })
    emitConversationUpdated([userId], { conversationId, lastMessageAt: newest ? newest.createdAt.toISOString() : null, reason: "mute" })

    return NextResponse.json({ mutedUntil })
  } catch (error) {
    console.error("conversation mute error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
