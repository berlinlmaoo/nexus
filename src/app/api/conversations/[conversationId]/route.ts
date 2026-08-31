import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { conversationId } = await params
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { members: { include: { user: { select: { id: true, name: true, avatar: true, email: true } } } } },
    })
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (conversation.type === "PROJECT" && conversation.projectId) {
      const { allowed } = await checkProjectAccess(session.user.id, conversation.projectId, ["MEMBER"])
      if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    } else if (!conversation.members.some((m) => m.userId === session.user!.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ conversation })
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

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, type: true, members: { select: { userId: true } } },
    })
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!conversation.members.some((m) => m.userId === session.user!.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
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
      include: { members: { include: { user: { select: { id: true, name: true, avatar: true, email: true } } } } },
    })
    return NextResponse.json({ conversation: updated })
  } catch (error) {
    console.error("conversation PATCH error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
