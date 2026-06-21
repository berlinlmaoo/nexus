export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { notifyTaskAssigned } from "@/lib/notification-service"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const task = await prisma.task.findUnique({
      where: { id: (await params).taskId },
      include: { taskList: { include: { project: true } } },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const existing = await prisma.taskAssignee.findUnique({
      where: {
        taskId_userId: {
          taskId: (await params).taskId,
          userId,
        },
      },
    })

    if (existing) {
      return NextResponse.json({ error: "User is already assigned" }, { status: 400 })
    }

    const assignee = await prisma.taskAssignee.create({
      data: {
        taskId: (await params).taskId,
        userId,
      },
      include: { user: true },
    })

    await prisma.activityLog.create({
      data: {
        action: "added assignee",
        details: `Added assignee to "${task.title}"`,
        userId: session.user.id!,
        taskId: (await params).taskId,
        projectId: task.taskList.projectId,
      },
    })

    // Send notification to the assignee, including self-assignment (don't block the response)
    notifyTaskAssigned({
      assigneeId: userId,
      taskId: (await params).taskId,
      taskTitle: task.title,
      projectName: task.taskList.project.name,
      projectId: task.taskList.projectId,
      assignedByName: session.user.name || "Someone",
    }).catch((err) => console.error("Notification error:", err))

    logAudit({ action: "create", entityType: "task_assignee", entityId: (await params).taskId, entityName: task.title, userId: session.user.id!, request, metadata: { assigneeUserId: userId } })

    return NextResponse.json(assignee, { status: 201 })
  } catch (error) {
    console.error("Error adding assignee:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const task = await prisma.task.findUnique({
      where: { id: (await params).taskId },
      include: { taskList: true },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const existing = await prisma.taskAssignee.findUnique({
      where: {
        taskId_userId: {
          taskId: (await params).taskId,
          userId,
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Assignee not found" }, { status: 404 })
    }

    await prisma.taskAssignee.delete({
      where: {
        taskId_userId: {
          taskId: (await params).taskId,
          userId,
        },
      },
    })

    await prisma.activityLog.create({
      data: {
        action: "removed assignee",
        details: `Removed assignee from "${task.title}"`,
        userId: session.user.id!,
        taskId: (await params).taskId,
        projectId: task.taskList.projectId,
      },
    })

    logAudit({ action: "delete", entityType: "task_assignee", entityId: (await params).taskId, entityName: task.title, userId: session.user.id!, request, metadata: { removedUserId: userId } })

    return NextResponse.json({ message: "Assignee removed" })
  } catch (error) {
    console.error("Error removing assignee:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
