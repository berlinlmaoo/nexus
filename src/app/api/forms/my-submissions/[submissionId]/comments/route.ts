export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { notifyCommentAdded } from "@/lib/notification-service"
import { emitCommentAdded } from "@/lib/socket-emitter"

// The submitter replies on their own request (owner, 12 Oct 2026): a comment on the request's task, as
// the submitter, without being a member of the project (finance / multimedia boards are not theirs).
// Only on their own submission; text only. The handlers (assignees + followers) are notified as for any
// comment, and the project board and the submitter's board update live.
export async function POST(request: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const { submissionId } = await params
    const body = (await request.json().catch(() => ({}))) as { content?: unknown; parentId?: unknown }
    const content = typeof body.content === "string" ? body.content.trim().slice(0, 4000) : ""
    if (!content) return NextResponse.json({ error: "Write something first." }, { status: 400 })

    const sub = await prisma.formSubmission.findUnique({
      where: { id: submissionId },
      select: { submitterId: true, task: { select: { id: true, title: true, taskList: { select: { projectId: true } } } } },
    })
    if (!sub || sub.submitterId !== me) return NextResponse.json({ error: "Submission not found" }, { status: 404 })
    if (!sub.task) return NextResponse.json({ error: "This request no longer has a task to reply on." }, { status: 409 })
    const task = sub.task

    let parentId: string | null = null
    if (typeof body.parentId === "string" && body.parentId) {
      const parent = await prisma.comment.findFirst({ where: { id: body.parentId, taskId: task.id }, select: { id: true } })
      parentId = parent?.id ?? null
    }

    const comment = await prisma.comment.create({
      data: { content, taskId: task.id, userId: me, ...(parentId ? { parentId } : {}) },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })
    await prisma.activityLog.create({
      data: { action: "added comment", details: `Added a comment on "${task.title}" (submitter)`, userId: me, taskId: task.id, projectId: task.taskList.projectId },
    })
    notifyCommentAdded({
      taskId: task.id, taskTitle: task.title, projectId: task.taskList.projectId,
      commentByName: session.user.name || "Someone", commentById: me, commentSnippet: content.slice(0, 200),
    }).catch(() => {})
    emitCommentAdded(task.taskList.projectId, task.id, JSON.parse(JSON.stringify(comment)))
    logAudit({ action: "create", entityType: "comment", entityId: comment.id, entityName: task.title, userId: me, request })

    return NextResponse.json({
      comment: { id: comment.id, content: comment.content, createdAt: comment.createdAt.toISOString(), parentId: comment.parentId, mine: true, user: comment.user },
    })
  } catch (error) {
    console.error("submission comment error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
