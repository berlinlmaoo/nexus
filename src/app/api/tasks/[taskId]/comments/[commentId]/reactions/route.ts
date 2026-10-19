export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { emitCommentAdded } from "@/lib/socket-emitter"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; commentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Signed in is not enough (writes batch): the comment must be on the task in the path, and the
    // caller must be able to read that task's comments (GET …/comments: checkProjectAccess VIEWER).
    // DELETE is untouched: it can only ever remove the caller's own reaction.
    const commentRef = await prisma.comment.findUnique({
      where: { id: (await params).commentId },
      select: { taskId: true, task: { select: { taskList: { select: { projectId: true } } } } },
    })
    if (!commentRef || commentRef.taskId !== (await params).taskId) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 })
    }
    if (!(await checkProjectAccess(session.user.id, commentRef.task.taskList.projectId, ["VIEWER"])).allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

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
      // deleteMany: a concurrent toggle may have removed it already (delete would throw P2025 → 500).
      await prisma.commentReaction.deleteMany({ where: { id: existing.id } })
      emitCommentAdded(commentRef.task.taskList.projectId, commentRef.taskId, { id: (await params).commentId, taskId: commentRef.taskId, change: "reaction" })
      return NextResponse.json({ toggled: "removed" })
    }

    let reaction
    try {
      reaction = await prisma.commentReaction.create({
        data: {
          commentId: (await params).commentId,
          userId: session.user.id,
          emoji,
        },
        include: { user: { select: { id: true, name: true } } },
      })
    } catch (e) {
      // A concurrent toggle (double tap) added the same reaction a moment ago: it is there, not a 500.
      if (!isUniqueViolation(e)) throw e
      // A third concurrent toggle may already have removed it again: then this tap ends as "removed"
      // (findUniqueOrThrow here answered 500 under 10 parallel taps, QA final 19 Oct).
      reaction = await prisma.commentReaction.findUnique({
        where: { commentId_userId_emoji: { commentId: (await params).commentId, userId: session.user.id, emoji } },
        include: { user: { select: { id: true, name: true } } },
      })
      if (!reaction) return NextResponse.json({ toggled: "removed" })
    }

    // Realtime (QA final 19 Oct): the others' open thread shows the reaction (comment-added = refetch the thread).
    emitCommentAdded(commentRef.task.taskList.projectId, commentRef.taskId, { id: (await params).commentId, taskId: commentRef.taskId, change: "reaction" })
    return NextResponse.json({ toggled: "added", reaction }, { status: 201 })
  } catch (error) {
    console.error("Error toggling reaction:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE = explicit, idempotent removal of the caller's own reaction (method-fix 2026-09-24).
// The web task panel (apps/web removeCommentReaction) sends DELETE with a JSON body
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
    if (count > 0) {
      const ref = await prisma.comment.findUnique({ where: { id: commentId }, select: { taskId: true, task: { select: { taskList: { select: { projectId: true } } } } } })
      if (ref) emitCommentAdded(ref.task.taskList.projectId, ref.taskId, { id: commentId, taskId: ref.taskId, change: "reaction" })
    }
    return NextResponse.json({ toggled: "removed", removed: count, success: true })
  } catch (error) {
    console.error("Error removing reaction:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
