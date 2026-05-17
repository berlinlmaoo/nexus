export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { notifyMention, notifyCommentAdded } from "@/lib/notification-service"
import { executeAutomations } from "@/lib/automation-engine"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import { emitCommentAdded } from "@/lib/socket-emitter"

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const comments = await prisma.comment.findMany({
      where: { taskId: params.taskId },
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
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { content, parentId } = body

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 })
    }

    const task = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: { taskList: true },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Validate parentId if provided
    if (parentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentId, taskId: params.taskId },
      })
      if (!parentComment) {
        return NextResponse.json({ error: "Parent comment not found" }, { status: 404 })
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        taskId: params.taskId,
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
        taskId: params.taskId,
        projectId: task.taskList.projectId,
      },
    })

    // Fire automations for comment_added
    executeAutomations(task.taskList.projectId, "comment_added", {
      taskId: params.taskId,
      userId: session.user.id!,
      projectId: task.taskList.projectId,
      commentId: comment.id,
    }).catch(() => {})

    // Webhook: comment.created
    dispatchWebhookEvent("comment.created", {
      commentId: comment.id,
      taskId: params.taskId,
      taskTitle: task.title,
      content: content.slice(0, 500),
      authorId: session.user.id!,
    }, task.taskList.projectId).catch(() => {})

    // Notify all assignees + followers about the new comment
    notifyCommentAdded({
      taskId: params.taskId,
      taskTitle: task.title,
      projectId: task.taskList.projectId,
      commentByName: session.user.name || "Someone",
      commentById: session.user.id!,
      commentSnippet: content.slice(0, 200),
    }).catch(() => {})

    logAudit({ action: "create", entityType: "comment", entityId: comment.id, entityName: task.title, userId: session.user.id!, request })

    // Auto-follow: commenter follows the task
    await prisma.taskFollower.upsert({
      where: { taskId_userId: { taskId: params.taskId, userId: session.user.id! } },
      create: { taskId: params.taskId, userId: session.user.id! },
      update: {},
    })

    // Detect @mentions and notify mentioned users
    const mentionRegex = /@(\S+)/g
    let match
    while ((match = mentionRegex.exec(content)) !== null) {
      const mentionName = match[1]
      // Try to find user by name or email prefix
      const mentionedUser = await prisma.user.findFirst({
        where: {
          OR: [
            { name: { contains: mentionName, mode: "insensitive" } },
            { email: { startsWith: mentionName.toLowerCase() } },
          ],
        },
        select: { id: true },
      })
      if (mentionedUser && mentionedUser.id !== session.user.id) {
        notifyMention({
          mentionedUserId: mentionedUser.id,
          mentionedByName: session.user.name || "Someone",
          taskId: params.taskId,
          taskTitle: task.title,
          commentSnippet: content.slice(0, 200),
          projectId: task.taskList.projectId,
        }).catch((err) => console.error("Mention notification error:", err))
      }
    }

    // Real-time: broadcast to project room
    emitCommentAdded(task.taskList.projectId, params.taskId, JSON.parse(JSON.stringify(comment)))

    return NextResponse.json(comment, { status: 201 })
  } catch (error) {
    console.error("Error creating comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
