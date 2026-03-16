import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { executeAutomations } from "@/lib/automation-engine"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import { emitTaskUpdated, emitTaskDeleted } from "@/lib/socket-emitter"
import { notifyTaskCompleted } from "@/lib/notification-service"

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
          include: {
            assignees: { include: { user: { select: { id: true, name: true, avatar: true } } } },
          },
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
    const { title, description, status, priority, dueDate, tags, taskListId, position, assigneeIds, isRecurring, recurPattern, taskType } = body

    const existing = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: { taskList: true, assignees: { select: { userId: true } } },
    })

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const { allowed } = await checkProjectAccess(session.user.id!, existing.taskList.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required to update tasks" }, { status: 403 })
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
        ...(isRecurring !== undefined && { isRecurring }),
        ...(recurPattern !== undefined && { recurPattern }),
        ...(taskType !== undefined && { taskType }),
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

    // Auto-create next occurrence for recurring tasks completed
    if (status === "DONE" && existing.status !== "DONE" && existing.isRecurring && existing.recurPattern) {
      const pattern = existing.recurPattern as { frequency: string; interval: number; daysOfWeek?: number[]; dayOfMonth?: number; endDate?: string }
      const baseDate = existing.dueDate ? new Date(existing.dueDate) : new Date()
      let nextDue: Date | null = null

      switch (pattern.frequency) {
        case "DAILY":
          nextDue = new Date(baseDate)
          nextDue.setDate(nextDue.getDate() + (pattern.interval || 1))
          break
        case "WEEKLY": {
          nextDue = new Date(baseDate)
          nextDue.setDate(nextDue.getDate() + 7 * (pattern.interval || 1))
          break
        }
        case "MONTHLY": {
          nextDue = new Date(baseDate)
          nextDue.setMonth(nextDue.getMonth() + (pattern.interval || 1))
          if (pattern.dayOfMonth) nextDue.setDate(pattern.dayOfMonth)
          break
        }
        case "YEARLY":
          nextDue = new Date(baseDate)
          nextDue.setFullYear(nextDue.getFullYear() + (pattern.interval || 1))
          break
      }

      if (nextDue && (!pattern.endDate || nextDue <= new Date(pattern.endDate))) {
        const nextTask = await prisma.task.create({
          data: {
            title: existing.title,
            description: existing.description,
            priority: existing.priority,
            tags: existing.tags,
            taskType: existing.taskType,
            taskListId: existing.taskListId,
            creatorId: session.user.id!,
            parentId: existing.parentId,
            isRecurring: true,
            recurPattern: existing.recurPattern as object,
            dueDate: nextDue,
            estimatedHours: existing.estimatedHours,
          },
        })
        // Copy assignees to new task
        if (existing.assignees.length > 0) {
          await prisma.taskAssignee.createMany({
            data: existing.assignees.map((a: { userId: string }) => ({ taskId: nextTask.id, userId: a.userId })),
          })
        }
      }
    }

    logAudit({
      action: "update", entityType: "task", entityId: params.taskId, entityName: task.title,
      userId: session.user.id!, request,
      metadata: { changes: body },
    })

    // Fire automations for status changes
    if (status !== undefined && status !== existing.status) {
      executeAutomations(existing.taskList.projectId, "task_status_changed", {
        taskId: params.taskId,
        userId: session.user.id!,
        projectId: existing.taskList.projectId,
        oldStatus: existing.status,
        newStatus: status,
      }).catch(() => {})
    }

    // Fire automations for assignee changes
    if (assigneeIds !== undefined) {
      executeAutomations(existing.taskList.projectId, "task_assigned", {
        taskId: params.taskId,
        userId: session.user.id!,
        projectId: existing.taskList.projectId,
        assigneeIds,
      }).catch(() => {})
    }

    // Notify assignees + followers when task is completed
    if (status === "DONE" && existing.status !== "DONE") {
      notifyTaskCompleted({
        taskId: params.taskId,
        taskTitle: task.title,
        projectId: existing.taskList.projectId,
        projectName: existing.taskList.name || "",
        completedByName: session.user.name || "Someone",
        completedById: session.user.id!,
      }).catch(() => {})
    }

    // Webhook: task.updated (or task.completed if status → DONE)
    const webhookEvent = (status === "DONE" && existing.status !== "DONE") ? "task.completed" : "task.updated"
    dispatchWebhookEvent(webhookEvent, {
      taskId: params.taskId,
      title: task.title,
      status: task.status,
      priority: task.priority,
      changes: body,
      previousStatus: existing.status,
    }, existing.taskList.projectId).catch(() => {})

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

        // Auto-follow: assigned users follow the task
        for (const userId of assigneeIds) {
          await prisma.taskFollower.upsert({
            where: { taskId_userId: { taskId: params.taskId, userId } },
            create: { taskId: params.taskId, userId },
            update: {},
          })
        }
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

      // Real-time: broadcast to project room
      emitTaskUpdated(existing.taskList.projectId, JSON.parse(JSON.stringify(updatedTask)))

      return NextResponse.json(updatedTask)
    }

    // Real-time: broadcast to project room
    emitTaskUpdated(existing.taskList.projectId, JSON.parse(JSON.stringify(task)))

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

    const { allowed } = await checkProjectAccess(session.user.id!, existing.taskList.projectId, ["LEAD"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: LEAD role required to delete tasks" }, { status: 403 })
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

    // Real-time: broadcast deletion to project room
    emitTaskDeleted(existing.taskList.projectId, params.taskId)

    return NextResponse.json({ message: "Task deleted" })
  } catch (error) {
    console.error("Error deleting task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
