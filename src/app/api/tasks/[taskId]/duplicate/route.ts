export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { executeAutomations } from "@/lib/automation-engine"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import { emitTaskCreated } from "@/lib/socket-emitter"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let dueDateOverride: string | null | undefined = undefined
    try {
      const rawBody = await request.text()
      if (rawBody) {
        const body = JSON.parse(rawBody) as { dueDate?: unknown }
        if ("dueDate" in body) {
          dueDateOverride = typeof body.dueDate === "string" ? body.dueDate : null
        }
      }
    } catch {
      dueDateOverride = undefined
    }

    const existing = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: {
        assignees: {
          select: { userId: true },
        },
        subtasks: {
          orderBy: { position: "asc" },
          include: {
            assignees: {
              select: { userId: true },
            },
          },
        },
        taskList: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        customFieldValues: {
          select: {
            customFieldId: true,
            value: true,
          },
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const { allowed } = await checkProjectAccess(session.user.id, existing.taskList.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required to duplicate tasks" }, { status: 403 })
    }

    const maxSiblingPosition = await prisma.task.aggregate({
      where: {
        taskListId: existing.taskListId,
        parentId: existing.parentId ?? null,
      },
      _max: {
        position: true,
      },
    })

    const duplicatedTask = await prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          title: `${existing.title} (Copy)`,
          description: existing.description,
          status: existing.status,
          priority: existing.priority,
          position: (maxSiblingPosition._max.position ?? -1) + 1,
          dueDate:
            dueDateOverride === undefined
              ? existing.dueDate
              : dueDateOverride
                ? new Date(dueDateOverride)
                : null,
          tags: existing.tags,
          estimatedHours: existing.estimatedHours,
          actualHours: existing.actualHours,
          taskType: existing.taskType,
          startDate: existing.startDate,
          isRecurring: existing.isRecurring,
          recurPattern: existing.recurPattern as object | undefined,
          taskListId: existing.taskListId,
          creatorId: session.user.id,
          parentId: existing.parentId,
        },
      })

      if (existing.assignees.length > 0) {
        await tx.taskAssignee.createMany({
          data: existing.assignees.map((assignee) => ({
            taskId: newTask.id,
            userId: assignee.userId,
          })),
          skipDuplicates: true,
        })

        await tx.taskFollower.createMany({
          data: existing.assignees.map((assignee) => ({
            taskId: newTask.id,
            userId: assignee.userId,
          })),
          skipDuplicates: true,
        })
      }

      if (existing.customFieldValues.length > 0) {
        await tx.customFieldValue.createMany({
          data: existing.customFieldValues.map((fieldValue) => ({
            customFieldId: fieldValue.customFieldId,
            taskId: newTask.id,
            value: fieldValue.value,
          })),
          skipDuplicates: true,
        })
      }

      if (existing.subtasks.length > 0) {
        for (const subtask of existing.subtasks) {
          const duplicatedSubtask = await tx.task.create({
            data: {
              title: subtask.title,
              description: subtask.description,
              status: subtask.status,
              priority: subtask.priority,
              position: subtask.position,
              dueDate: subtask.dueDate,
              tags: subtask.tags,
              estimatedHours: subtask.estimatedHours,
              actualHours: subtask.actualHours,
              taskType: subtask.taskType,
              startDate: subtask.startDate,
              isRecurring: subtask.isRecurring,
              recurPattern: subtask.recurPattern as object | undefined,
              taskListId: newTask.taskListId,
              creatorId: session.user.id,
              parentId: newTask.id,
            },
          })

          if (subtask.assignees.length > 0) {
            await tx.taskAssignee.createMany({
              data: subtask.assignees.map((assignee) => ({
                taskId: duplicatedSubtask.id,
                userId: assignee.userId,
              })),
              skipDuplicates: true,
            })
          }
        }
      }

      return tx.task.findUniqueOrThrow({
        where: { id: newTask.id },
        include: {
          assignees: { include: { user: true } },
          creator: true,
          taskList: true,
          _count: {
            select: { subtasks: true, comments: true },
          },
        },
      })
    })

    await seedTaskCustomFieldValues(duplicatedTask.id, existing.taskList.projectId, duplicatedTask.createdAt)

    await prisma.activityLog.create({
      data: {
        action: "duplicated task",
        details: `Duplicated task "${existing.title}"`,
        userId: session.user.id,
        taskId: duplicatedTask.id,
        projectId: existing.taskList.projectId,
      },
    })

    logAudit({
      action: "create",
      entityType: "task",
      entityId: duplicatedTask.id,
      entityName: duplicatedTask.title,
      userId: session.user.id,
      request,
      metadata: {
        duplicatedFrom: existing.id,
      },
    })

    executeAutomations(existing.taskList.projectId, "task_created", {
      taskId: duplicatedTask.id,
      userId: session.user.id,
      projectId: existing.taskList.projectId,
      assigneeIds: existing.assignees.map((assignee) => assignee.userId),
    }).catch(() => {})

    dispatchWebhookEvent("task.created", {
      taskId: duplicatedTask.id,
      title: duplicatedTask.title,
      status: duplicatedTask.status,
      priority: duplicatedTask.priority,
      taskListId: duplicatedTask.taskListId,
      creatorId: session.user.id,
      duplicatedFrom: existing.id,
    }, existing.taskList.projectId).catch(() => {})

    emitTaskCreated(existing.taskList.projectId, JSON.parse(JSON.stringify(duplicatedTask)))

    return NextResponse.json({ task: duplicatedTask }, { status: 201 })
  } catch (error) {
    console.error("Error duplicating task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
