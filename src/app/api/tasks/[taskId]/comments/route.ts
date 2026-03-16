import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { notifyMention } from "@/lib/notification-service"

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const comments = await prisma.comment.findMany({
      where: { taskId: params.taskId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json(comments)
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
    const { content } = body

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

    const comment = await prisma.comment.create({
      data: {
        content,
        taskId: params.taskId,
        userId: session.user.id!,
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

    return NextResponse.json(comment, { status: 201 })
  } catch (error) {
    console.error("Error creating comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
