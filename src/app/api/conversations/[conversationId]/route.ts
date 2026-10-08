import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { emitConversationUpdated } from "@/lib/socket-emitter"
import { CHAT_MEMBER_SELECT, canManageMembersOf, conversationAccess } from "@/lib/chat-access"

/**
 * One conversation. Adds, for the caller: `mutedUntil` (null when not muted) and `canManageMembers`
 * — whether they may add or remove people (GROUP only, Manager and above; chat-rules
 * canManageGroupMembers). Clients hide those controls when it is false.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { conversationId } = await params
    // Project room: the project decides; group/DM: a member still in the room's workspace.
    const access = await conversationAccess(session.user.id, conversationId)
    if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status })
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { members: { select: CHAT_MEMBER_SELECT } },
    })
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const mutedUntil = access.member?.mutedUntil && access.member.mutedUntil.getTime() > Date.now()
      ? access.member.mutedUntil.toISOString()
      : null
    const canManageMembers = await canManageMembersOf(session.user.id, conversation)
    return NextResponse.json({ conversation: { ...conversation, mutedUntil, canManageMembers } })
  } catch (error) {
    console.error("conversation GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Rename a group chat.
 *
 * Only GROUP rooms have a name of their own. A DM is titled after the other person, and a PROJECT
 * room borrows the project's name - letting either be renamed here would put a second, divergent
 * source of truth on screen, so both are refused with a reason rather than silently ignored.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { conversationId } = await params

    const access = await conversationAccess(session.user.id, conversationId)
    if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status })
    const conversation = access.convo
    // Renaming stays a members-only act (a BoD reading a project room is refused below anyway).
    if (!access.member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (conversation.type !== "GROUP") {
      return NextResponse.json(
        { error: conversation.type === "PROJECT" ? "A project chat is named after its project" : "A direct message has no name" },
        { status: 400 }
      )
    }

    const { name } = await req.json()
    const trimmed = typeof name === "string" ? name.trim() : ""
    if (!trimmed) return NextResponse.json({ error: "name required" }, { status: 400 })
    if (trimmed.length > 80) return NextResponse.json({ error: "name too long" }, { status: 400 })

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: { name: trimmed },
      include: { members: { select: CHAT_MEMBER_SELECT } },
    })
    emitConversationUpdated(updated.members.map((m) => m.userId), {
      conversationId,
      lastMessageAt: updated.updatedAt.toISOString(),
      reason: "membership",
    })
    return NextResponse.json({ conversation: updated })
  } catch (error) {
    console.error("conversation PATCH error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
