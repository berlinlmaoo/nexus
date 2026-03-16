import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const task = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: {
        assignees: { include: { user: true } },
        comments: {
          include: { user: true },
          orderBy: { createdAt: "asc" },
        },
        subtasks: {
          orderBy: { position: "asc" },
        },
        activityLogs: {
          include: { user: true },
          orderBy: { createdAt: "desc" },
        },
        taskList: true,
        creator: true,
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    return NextResponse.json(task)
  } catch (error) {
    console.error("Error fetching task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { title, description, status, priority, dueDate, tags, taskListId, position, assigneeIds } = body

    const existing = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: { taskList: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const task = await prisma.task.update({
      where: { id: params.taskId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(tags !== undefined && { tags }),
        ...(taskListId !== undefined && { taskListId }),
        ...(position !== undefined && { position }),
      },
      include: {
        assignees: { include: { user: true } },
        creator: true,
        taskList: true,
        _count: {
          select: { subtasks: true, comments: true },
        },
      },
    })

    if (status !== undefined && status !== existing.status) {
      await prisma.activityLog.create({
        data: {
          action: "changed status",
          details: `Changed status from ${existing.status} to ${status}`,
          userId: session.user.id!,
          taskId: params.taskId,
          projectId: existing.taskList.projectId,
        },
      })
    }

    logAudit({
      action: "update", entityType: "task", entityId: params.taskId, entityName: task.title,
      userId: session.user.id!, request,
      metadata: { changes: body },
    })

    if (assigneeIds !== undefined) {
      await prisma.taskAssignee.deleteMany({
        where: { taskId: params.taskId },
      })

      if (assigneeIds.length > 0) {
        await prisma.taskAssignee.createMany({
          data: assigneeIds.map((userId: string) => ({
            taskId: params.taskId,
            userId,
          })),
        })
      }

      const updatedTask = await prisma.task.findUnique({
        where: { id: params.taskId },
        include: {
          assignees: { include: { user: true } },
          creator: true,
          taskList: true,
          _count: {
            select: { subtasks: true, comments: true },
          },
        },
      })

      return NextResponse.json(updatedTask)
    }

    return NextResponse.json(task)
  } catch (error) {
    console.error("Error updating task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: { taskList: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    await prisma.activityLog.create({
      data: {
        action: "deleted task",
        details: `Deleted task "${existing.title}"`,
        userId: session.user.id!,
        projectId: existing.taskList.projectId,
      },
    })

    logAudit({
      action: "delete", entityType: "task", entityId: params.taskId, entityName: existing.title,
      userId: session.user.id!, request,
    })

    await prisma.task.delete({
      where: { id: params.taskId },
    })

    return NextResponse.json({ message: "Task deleted" })
  } catch (error) {
    console.error("Error deleting task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
