export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { executeAutomations } from "@/lib/automation-engine"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import { emitTaskUpdated, emitTaskDeleted } from "@/lib/socket-emitter"
import { notifyTaskAssigned, notifyTaskCompleted, notifySubmissionStatus } from "@/lib/notification-service"
import { bumpStreak } from "@/lib/gamification"
import { updateTaskSchema, validateBody } from "@/lib/validations"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const [task, likeCount, userLike, taskProjects, questRows] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        include: {
          assignees: { include: { user: true } },
          comments: {
            include: { user: true },
            orderBy: { createdAt: "asc" },
          },
          // Breadcrumb context: a subtask's panel shows (and navigates back to) its parent.
          parent: { select: { id: true, title: true } },
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
          taskList: { include: { project: { select: { id: true, name: true, color: true, icon: true } } } },
          creator: true,
        },
      }),
      prisma.taskLike.count({ where: { taskId: taskId } }),
      prisma.taskLike.findUnique({
        where: { taskId_userId: { taskId: taskId, userId: session.user.id! } },
      }),
      prisma.taskProject.findMany({
        where: { taskId: taskId },
        include: {
          project: { select: { id: true, name: true, color: true, icon: true } },
          taskList: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      // Active task-bundle quests that include this task (for the "+X XP" nudge on the task panel).
      prisma.quest.findMany({
        where: { isActive: true, requirementType: "specific_tasks", taskIds: { has: taskId } },
        select: { id: true, title: true, xpReward: true, taskIds: true },
      }),
    ])

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const quests = await Promise.all(
      questRows.map(async (q) => ({
        id: q.id,
        title: q.title,
        xpReward: q.xpReward,
        total: q.taskIds.length,
        done: await prisma.task.count({ where: { id: { in: q.taskIds }, status: "DONE" } }),
      }))
    )

    return NextResponse.json({
      ...task,
      likeCount,
      liked: !!userLike,
      taskProjects,
      quests,
    })
  } catch (error) {
    console.error("Error fetching task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed: rlAllowed, resetAt } = checkRateLimit(request, session.user.id!, { limit: 60, windowSeconds: 60 })
    if (!rlAllowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    const validation = validateBody(updateTaskSchema, body)
    if (!validation.success) return validation.error

    const {
      title,
      description,
      status,
      priority,
      dueDate,
      tags,
      projectContextId,
      taskListId,
      position,
      assigneeIds,
      isRecurring,
      recurPattern,
      taskType,
    } = validation.data

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        taskList: { include: { project: true } },
        assignees: { select: { userId: true } },
        customFieldValues: {
          select: {
            customFieldId: true,
            value: true,
          },
        },
        taskProjects: {
          select: {
            id: true,
            projectId: true,
            taskListId: true,
            position: true,
          },
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const effectiveProjectId = projectContextId ?? existing.taskList.projectId

    const { allowed } = await checkProjectAccess(session.user.id!, effectiveProjectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required to update tasks" }, { status: 403 })
    }

    // Gate: a project can require ≥1 attachment before a task may be marked DONE (finance
    // proof-of-completion). Checked only on the TODO/…→DONE transition, against the task's home project.
    if (status === "DONE" && existing.status !== "DONE") {
      const gateProject = await prisma.project.findUnique({
        where: { id: existing.taskList.projectId },
        select: { requireAttachmentForDone: true },
      })
      if (gateProject?.requireAttachmentForDone) {
        // Counts ONLY the separate "Bukti Pencairan" (PROOF) channel — form-submission docs / general
        // attachments (kind=GENERAL) do NOT satisfy the gate.
        const proofCount = await prisma.attachment.count({ where: { taskId, kind: "PROOF" } })
        if (proofCount === 0) {
          return NextResponse.json(
            { error: "Task ini butuh minimal 1 Bukti Pencairan dulu sebelum bisa ditandai Done.", code: "PROOF_REQUIRED" },
            { status: 400 }
          )
        }
      }
    }

    const updateData: Record<string, unknown> = {}
    const linkedPlacementData: Record<string, unknown> = {}
    if (title !== undefined) updateData.title = title
    if (description !== undefined) updateData.description = description
    if (status !== undefined) updateData.status = status
    if (priority !== undefined) updateData.priority = priority
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null
    if (tags !== undefined) updateData.tags = tags
    if (isRecurring !== undefined) updateData.isRecurring = isRecurring
    if (recurPattern !== undefined) updateData.recurPattern = recurPattern
    if (taskType !== undefined) updateData.taskType = taskType

    const primaryProjectId = existing.taskList.projectId
    const isLinkedProjectContext = effectiveProjectId !== primaryProjectId

    if (taskListId !== undefined) {
      const targetTaskList = await prisma.taskList.findFirst({
        where: { id: taskListId, projectId: effectiveProjectId },
        select: { id: true },
      })

      if (!targetTaskList) {
        return NextResponse.json({ error: "Task list not found in the selected project" }, { status: 404 })
      }

      if (isLinkedProjectContext) linkedPlacementData.taskListId = taskListId
      else updateData.taskListId = taskListId
    }

    if (position !== undefined) {
      if (isLinkedProjectContext) linkedPlacementData.position = position
      else updateData.position = position
    }

    let task: any = {
      ...existing,
      ...updateData,
      dueDate:
        updateData.dueDate !== undefined
          ? (updateData.dueDate as Date | null)
          : existing.dueDate,
      taskListId:
        updateData.taskListId !== undefined
          ? (updateData.taskListId as string)
          : existing.taskListId,
      position:
        updateData.position !== undefined
          ? (updateData.position as number)
          : existing.position,
    }

    if (Object.keys(updateData).length > 0) {
      task = await prisma.task.update({
        where: { id: taskId },
        data: updateData,
        include: {
          assignees: { include: { user: true } },
          creator: true,
          taskList: true,
          _count: {
            select: { subtasks: true, comments: true },
          },
        },
      })
    }

    if (isLinkedProjectContext && Object.keys(linkedPlacementData).length > 0) {
      const linkedPlacement = existing.taskProjects.find(
        (taskProject) => taskProject.projectId === effectiveProjectId
      )

      if (!linkedPlacement) {
        return NextResponse.json({ error: "Task is not linked to the selected project" }, { status: 404 })
      }

      await prisma.taskProject.update({
        where: { id: linkedPlacement.id },
        data: linkedPlacementData,
      })
    }

    if (status !== undefined && status !== existing.status) {
      await prisma.activityLog.create({
        data: {
          action: "changed status",
          details: `Changed status from ${existing.status} to ${status}`,
          userId: session.user.id!,
          taskId: taskId,
          projectId: effectiveProjectId,
        },
      })

      // A form submission may be riding on this task; its owner watches this status on their
      // "Pengajuan Saya" board and otherwise gets no word that it moved. Best-effort: a failure
      // here must never take down the status change itself.
      try {
        const submission = await prisma.formSubmission.findUnique({
          where: { taskId },
          select: { submitterId: true, form: { select: { name: true } } },
        })
        if (submission?.submitterId && submission.submitterId !== session.user.id) {
          await notifySubmissionStatus({
            submitterId: submission.submitterId,
            formName: submission.form?.name ?? "your submission",
            fromStatus: existing.status,
            toStatus: status as string,
            updatedByName: session.user.name ?? "Someone",
          })
        }
      } catch (error) {
        console.error("submission status notification failed", error)
      }
    }

    // Gamification: task completion grants NO direct XP (quest-only model — XP for task
    // work comes solely from quests assigned by a Head/BoD, claimed at most once per
    // period). We only tick the daily activity streak here (+5 once/day, not farmable).
    if (status === "DONE" && existing.status !== "DONE") {
      try {
        await bumpStreak(session.user.id!)
      } catch (xpErr) {
        console.error("streak bump (task done) failed:", xpErr)
      }
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

          if (existing.customFieldValues.length > 0) {
            await prisma.customFieldValue.createMany({
              data: existing.customFieldValues.map((fieldValue) => ({
                customFieldId: fieldValue.customFieldId,
                taskId: nextTask.id,
                value: fieldValue.value,
              })),
              skipDuplicates: true,
            })
          }

          await seedTaskCustomFieldValues(nextTask.id, existing.taskList.projectId, nextTask.createdAt)
        }
      }

    logAudit({
      action: "update", entityType: "task", entityId: taskId, entityName: task.title,
      userId: session.user.id!, request,
      metadata: { changes: body },
    })

    // Fire automations for status changes
    if (status !== undefined && status !== existing.status) {
      executeAutomations(existing.taskList.projectId, "task_status_changed", {
        taskId: taskId,
        userId: session.user.id!,
        projectId: effectiveProjectId,
        oldStatus: existing.status,
        newStatus: status,
      }).catch(() => {})
    }

    // Fire automations for assignee changes
    if (assigneeIds !== undefined) {
      executeAutomations(existing.taskList.projectId, "task_assigned", {
        taskId: taskId,
        userId: session.user.id!,
        projectId: effectiveProjectId,
        assigneeIds,
      }).catch(() => {})
    }

    // Notify assignees + followers when task is completed
    if (status === "DONE" && existing.status !== "DONE") {
      notifyTaskCompleted({
        taskId: taskId,
        taskTitle: task.title,
        projectId: effectiveProjectId,
        projectName: existing.taskList.name || "",
        completedByName: session.user.name || "Someone",
        completedById: session.user.id!,
      }).catch(() => {})
    }

    // Webhook: task.updated (or task.completed if status → DONE)
    const webhookEvent = (status === "DONE" && existing.status !== "DONE") ? "task.completed" : "task.updated"
    dispatchWebhookEvent(webhookEvent, {
      taskId: taskId,
      title: task.title,
      status: task.status,
      priority: task.priority,
      changes: body,
      previousStatus: existing.status,
    }, effectiveProjectId).catch(() => {})

    if (assigneeIds !== undefined) {
      await prisma.taskAssignee.deleteMany({
        where: { taskId: taskId },
      })

      if (assigneeIds.length > 0) {
        await prisma.taskAssignee.createMany({
          data: assigneeIds.map((userId: string) => ({
            taskId: taskId,
            userId,
          })),
        })

        // Auto-follow: assigned users follow the task
        for (const userId of assigneeIds) {
          await prisma.taskFollower.upsert({
            where: { taskId_userId: { taskId: taskId, userId } },
            create: { taskId: taskId, userId },
            update: {},
          })
        }

        const previousAssigneeIds = new Set(existing.assignees.map((assignee) => assignee.userId))
        const newlyAssignedIds = assigneeIds.filter((userId: string) => !previousAssigneeIds.has(userId))
        await Promise.allSettled(newlyAssignedIds.map((assigneeId: string) => notifyTaskAssigned({
          assigneeId,
          taskId,
          taskTitle: task.title,
          projectName: existing.taskList.project.name,
          projectId: effectiveProjectId,
          assignedByName: session.user.name || "Someone",
        })))
      }

      const updatedTask = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          assignees: { include: { user: true } },
          creator: true,
          taskList: true,
          _count: {
            select: { subtasks: true, comments: true },
          },
        },
      })

      const relatedProjectIds = [
        existing.taskList.projectId,
        ...existing.taskProjects.map((taskProject) => taskProject.projectId),
      ]
      for (const projectId of Array.from(new Set(relatedProjectIds))) {
        emitTaskUpdated(projectId, JSON.parse(JSON.stringify(updatedTask)))
      }

      return NextResponse.json(updatedTask)
    }

    const relatedProjectIds = [
      existing.taskList.projectId,
      ...existing.taskProjects.map((taskProject) => taskProject.projectId),
    ]
    for (const projectId of Array.from(new Set(relatedProjectIds))) {
      emitTaskUpdated(projectId, JSON.parse(JSON.stringify(task)))
    }

    return NextResponse.json(task)
  } catch (error) {
    console.error("Error updating task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        taskList: true,
        taskProjects: {
          select: { projectId: true },
        },
      },
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
      action: "delete", entityType: "task", entityId: taskId, entityName: existing.title,
      userId: session.user.id!, request,
    })

    await prisma.task.delete({
      where: { id: taskId },
    })

    const relatedProjectIds = [
      existing.taskList.projectId,
      ...existing.taskProjects.map((taskProject) => taskProject.projectId),
    ]
    for (const projectId of Array.from(new Set(relatedProjectIds))) {
      emitTaskDeleted(projectId, taskId)
    }

    return NextResponse.json({ message: "Task deleted" })
  } catch (error) {
    console.error("Error deleting task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
