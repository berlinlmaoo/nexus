export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; commentId: string }> }
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
          commentId: (await params).commentId,
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
        commentId: (await params).commentId,
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

// DELETE = explicit, idempotent removal of the caller's own reaction (method-fix 2026-09-24).
// The web task panel (apps/nexus-lovable-ui removeCommentReaction) sends DELETE with a JSON body
// { emoji }; before this handler existed it answered 405. Unlike POST this never toggles:
// removing a reaction that is not there is a no-op. Same checks as POST (signed in + emoji given);
// it can only ever delete rows owned by the caller.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; commentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let emoji: unknown = null
    try {
      const body = await request.json()
      if (body && typeof body === "object") emoji = (body as { emoji?: unknown }).emoji
    } catch {
      // no/invalid JSON body - fall back to ?emoji= below
    }
    if (!emoji) emoji = request.nextUrl.searchParams.get("emoji")
    if (typeof emoji !== "string" || !emoji) {
      return NextResponse.json({ error: "Emoji is required" }, { status: 400 })
    }

    const { commentId } = await params
    const { count } = await prisma.commentReaction.deleteMany({
      where: { commentId, userId: session.user.id, emoji },
    })
    return NextResponse.json({ toggled: "removed", removed: count, success: true })
  } catch (error) {
    console.error("Error removing reaction:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
