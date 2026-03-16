import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

export async function PATCH(
  request: NextRequest,
  { params }: { params: { taskId: string; commentId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const comment = await prisma.comment.findUnique({
      where: { id: params.commentId, taskId: params.taskId },
    })

    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 })
    }

    if (comment.userId !== session.user.id) {
      return NextResponse.json({ error: "You can only edit your own comments" }, { status: 403 })
    }

    const body = await request.json()
    const { content } = body

    if (!content || !content.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 })
    }

    const updated = await prisma.comment.update({
      where: { id: params.commentId },
      data: { content: content.trim(), isEdited: true },
      include: { user: true },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { taskId: string; commentId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const comment = await prisma.comment.findUnique({
      where: { id: params.commentId, taskId: params.taskId },
      include: {
        task: {
          include: {
            taskList: {
              include: {
                project: {
                  include: {
                    members: {
                      where: { userId: session.user.id!, role: "LEAD" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 })
    }

    const isAuthor = comment.userId === session.user.id
    const isProjectLead = comment.task.taskList.project.members.length > 0

    if (!isAuthor && !isProjectLead) {
      return NextResponse.json({ error: "You can only delete your own comments or be a project lead" }, { status: 403 })
    }

    await prisma.comment.delete({ where: { id: params.commentId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
