export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { notifyMention, notifyCommentAdded } from "@/lib/notification-service"
import { executeAutomations } from "@/lib/automation-engine"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import { emitCommentAdded } from "@/lib/socket-emitter"
import { checkProjectAccess } from "@/lib/rbac"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const taskId = (await params).taskId
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { taskList: { select: { projectId: true } } } })
    if (!task?.taskList?.projectId) return NextResponse.json({ error: "Task not found" }, { status: 404 })
    if (!(await checkProjectAccess(session.user.id, task.taskList.projectId, ["VIEWER"])).allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const comments = await prisma.comment.findMany({
      where: { taskId },
      include: {
        user: true,
        reactions: {
          include: { user: { select: { id: true, name: true } } },
        },
        replies: {
          include: {
            user: true,
            reactions: {
              include: { user: { select: { id: true, name: true } } },
            },
            replies: {
              include: {
                user: true,
                reactions: {
                  include: { user: { select: { id: true, name: true } } },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    })

    // Return only top-level comments with nested replies
    const topLevel = comments.filter(c => !c.parentId)

    return NextResponse.json({ comments: topLevel, currentUserId: session.user.id })
  } catch (error) {
    console.error("Error fetching comments:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { content, parentId, mentionedUserIds } = body

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 })
    }

    const task = await prisma.task.findUnique({
      where: { id: (await params).taskId },
      include: { taskList: true },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }
    if (!(await checkProjectAccess(session.user.id!, task.taskList.projectId, ["MEMBER"])).allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Validate parentId if provided
    if (parentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentId, taskId: (await params).taskId },
      })
      if (!parentComment) {
        return NextResponse.json({ error: "Parent comment not found" }, { status: 404 })
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        taskId: (await params).taskId,
        userId: session.user.id!,
        ...(parentId && { parentId }),
      },
      include: { user: true },
    })

    await prisma.activityLog.create({
      data: {
        action: "added comment",
        details: `Added a comment on "${task.title}"`,
        userId: session.user.id!,
        taskId: (await params).taskId,
        projectId: task.taskList.projectId,
      },
    })

    // Fire automations for comment_added
    executeAutomations(task.taskList.projectId, "comment_added", {
      taskId: (await params).taskId,
      userId: session.user.id!,
      projectId: task.taskList.projectId,
      commentId: comment.id,
    }).catch(() => {})

    // Webhook: comment.created
    dispatchWebhookEvent("comment.created", {
      commentId: comment.id,
      taskId: (await params).taskId,
      taskTitle: task.title,
      content: content.slice(0, 500),
      authorId: session.user.id!,
    }, task.taskList.projectId).catch(() => {})

    // Notify all assignees + followers about the new comment
    notifyCommentAdded({
      taskId: (await params).taskId,
      taskTitle: task.title,
      projectId: task.taskList.projectId,
      commentByName: session.user.name || "Someone",
      commentById: session.user.id!,
      commentSnippet: content.slice(0, 200),
    }).catch(() => {})

    logAudit({ action: "create", entityType: "comment", entityId: comment.id, entityName: task.title, userId: session.user.id!, request })

    // Auto-follow: commenter follows the task
    await prisma.taskFollower.upsert({
      where: { taskId_userId: { taskId: (await params).taskId, userId: session.user.id! } },
      create: { taskId: (await params).taskId, userId: session.user.id! },
      update: {},
    })

    // Notify mentioned users. Prefer the EXACT ids the client sent (from the @-autocomplete) so the right
    // person is hit regardless of name collisions — scoped to project members for safety. Fall back to
    // parsing @name from the text for older clients that don't send ids.
    const taskIdResolved = (await params).taskId
    const mentionIds = new Set<string>()
    if (Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
      const ids = mentionedUserIds.filter((x: unknown): x is string => typeof x === "string")
      if (ids.length > 0) {
        const members = await prisma.projectMember.findMany({
          where: { projectId: task.taskList.projectId, userId: { in: ids } },
          select: { userId: true },
        })
        for (const m of members) mentionIds.add(m.userId)
      }
    } else {
      const mentionRegex = /@(\S+)/g
      let match
      while ((match = mentionRegex.exec(content)) !== null) {
        const mentionName = match[1]
        const mentionedUser = await prisma.user.findFirst({
          where: {
            OR: [
              { name: { contains: mentionName, mode: "insensitive" } },
              { email: { startsWith: mentionName.toLowerCase() } },
            ],
          },
          select: { id: true },
        })
        if (mentionedUser) mentionIds.add(mentionedUser.id)
      }
    }
    // Note: we do NOT skip self here — parity with task-assignment (which also notifies you when you
    // assign yourself), and it lets a single account verify the mention → WhatsApp pipeline end-to-end.
    for (const uid of mentionIds) {
      notifyMention({
        mentionedUserId: uid,
        mentionedByName: session.user.name || "Someone",
        taskId: taskIdResolved,
        taskTitle: task.title,
        commentSnippet: content.slice(0, 200),
        projectId: task.taskList.projectId,
      }).catch((err) => console.error("Mention notification error:", err))
    }

    // Real-time: broadcast to project room
    emitCommentAdded(task.taskList.projectId, (await params).taskId, JSON.parse(JSON.stringify(comment)))

    return NextResponse.json(comment, { status: 201 })
  } catch (error) {
    console.error("Error creating comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
