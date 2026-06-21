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
