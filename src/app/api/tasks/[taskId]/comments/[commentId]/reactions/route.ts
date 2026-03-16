import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string; commentId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { emoji } = await request.json()
    if (!emoji) return NextResponse.json({ error: "Emoji is required" }, { status: 400 })

    // Toggle: if reaction exists, remove it; if not, add it
    const existing = await prisma.commentReaction.findUnique({
      where: {
        commentId_userId_emoji: {
          commentId: params.commentId,
          userId: session.user.id,
          emoji,
        },
      },
    })

    if (existing) {
      await prisma.commentReaction.delete({ where: { id: existing.id } })
      return NextResponse.json({ toggled: "removed" })
    }

    const reaction = await prisma.commentReaction.create({
      data: {
        commentId: params.commentId,
        userId: session.user.id,
        emoji,
      },
      include: { user: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ toggled: "added", reaction }, { status: 201 })
  } catch (error) {
    console.error("Error toggling reaction:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
