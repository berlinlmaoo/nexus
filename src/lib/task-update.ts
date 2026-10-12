import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { sectionForStatus } from "@/lib/status-sections"
import { logAudit } from "@/lib/audit"
import { auditDiff } from "@/lib/audit-describe"
import { checkProjectAccess } from "@/lib/rbac"
import { runAutomations } from "@/lib/automation-engine"
import { emitTaskUpdated } from "@/lib/socket-emitter"
import { notifyTaskAssigned, notifyTaskCompleted, notifySubmissionStatus } from "@/lib/notification-service"
import { bumpStreak } from "@/lib/gamification"
import { updateTaskSchema, validateBody } from "@/lib/validations"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"

/** The signed-in user a task edit is made by (what auth() returns, narrowed to what the rules read). */
export type TaskUpdateSession = { user: { id?: string | null; name?: string | null } }

/**
 * One task edit (the body of PATCH /api/tasks/[taskId], validated by updateTaskSchema): access check,
 * section ↔ status rules, completion stamps, recurring follow-up, activity log, audit, notifications,
 * automations and the per-task `task-updated` realtime event. Moved here verbatim from the
 * PATCH route so POST /api/tasks/batch-move applies exactly the same rules to every task it moves.
 * The caller authenticates and rate-limits; errors thrown here are the caller's to turn into a 500.
 */
export async function applyTaskUpdate({
  request,
  session,
  taskId,
  body,
}: {
  request: NextRequest
  session: TaskUpdateSession
  taskId: string
  body: unknown
}): Promise<NextResponse> {
  const validation = validateBody(updateTaskSchema, body)
  if (!validation.success) return validation.error

  const {
    title,
    description,
    status: requestedStatus,
    priority,
    dueDate,
    startDate,
    estimatedHours,
    actualHours,
    tags,
    projectContextId,
    taskListId,
    position,
    assigneeIds,
    isRecurring,
    recurPattern,
    taskType,
  } = validation.data
  // May be set below from the section the task moves into (TaskList.taskStatus, project templates).
  let status = requestedStatus

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

  const primaryProjectId = existing.taskList.projectId
  const isLinkedProjectContext = effectiveProjectId !== primaryProjectId

  // Sections that stand for a status (project templates, owner 12 Oct 2026; TaskList.taskStatus). In
  // the task's own project only, never through a linked placement, and only when the request does not
  // say both things itself:
  //  - moved into such a section without a status → the task takes the section's status
  //    (Content Plan: drag to "Published" = DONE, for reports, Overview and every app);
  //  - status changed without a move, out of such a section → it moves to the first section of that
  //    status, so the board keeps showing where it stands. No such section → it stays where it is.
  // Plain sections (taskStatus null, every project before templates) behave exactly as before.
  let statusSection: { id: string } | null = null
  if (!isLinkedProjectContext) {
    if (requestedStatus === undefined && taskListId !== undefined && taskListId !== existing.taskListId) {
      const target = await prisma.taskList.findFirst({
        where: { id: taskListId, projectId: primaryProjectId },
        select: { taskStatus: true },
      })
      if (target?.taskStatus && target.taskStatus !== existing.status) status = target.taskStatus
    } else if (
      requestedStatus !== undefined &&
      requestedStatus !== existing.status &&
      taskListId === undefined &&
      existing.taskList.taskStatus
    ) {
      // Sections are the status options (owner, 12 Oct 2026): the exact status's section, else the
      // first of its group (lib/status-sections.ts). Released apps PATCH the enum and land here too.
      const target = await sectionForStatus(prisma, primaryProjectId, existing.taskListId, requestedStatus)
      statusSection = target ? { id: target } : null
    }
  }

  const updateData: Record<string, unknown> = {}
  const linkedPlacementData: Record<string, unknown> = {}
  if (statusSection) updateData.taskListId = statusSection.id
  if (title !== undefined) updateData.title = title
  if (description !== undefined) updateData.description = description
  if (status !== undefined) updateData.status = status
  // Who completed it. completedAt itself is stamped by the DB trigger (Task_completion_stamp).
  if (status === "DONE" && existing.status !== "DONE") updateData.completedById = session.user.id
  if (priority !== undefined) updateData.priority = priority
  if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null
  // Validated by updateTaskSchema but never written before (API.md E2): iOS "Start date" edits were
  // answered 200 and dropped. Same date handling as dueDate ("YYYY-MM-DD" or ISO; null clears).
  if (startDate !== undefined) {
    const parsedStart = startDate ? new Date(startDate) : null
    if (parsedStart && Number.isNaN(parsedStart.getTime())) {
      return NextResponse.json({ error: "Invalid start date" }, { status: 400 })
    }
    updateData.startDate = parsedStart
  }
  if (estimatedHours !== undefined) updateData.estimatedHours = estimatedHours
  if (actualHours !== undefined) updateData.actualHours = actualHours
  if (tags !== undefined) updateData.tags = tags
  if (isRecurring !== undefined) updateData.isRecurring = isRecurring
  if (recurPattern !== undefined) updateData.recurPattern = recurPattern
  if (taskType !== undefined) updateData.taskType = taskType

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
        select: { id: true, submitterId: true },
      })
      if (submission?.submitterId && submission.submitterId !== session.user.id) {
        await notifySubmissionStatus({
          submitterId: submission.submitterId,
          submissionId: submission.id,
          // The task's title IS the submission's subject ("ZALEEFYA - QUEENBAR"), and it is the
          // label the submitter already sees on their "Pengajuan Saya" card. The form's name is
          // useless here: one form backs every request in the column, so quoting it turns a
          // cleared column of distinct submissions into a wall of identical notifications.
          subject: title ?? existing.title,
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

  // Old AND new value of exactly the fields this request changed, taken from `existing` (already
  // loaded above — no extra read). This used to log the raw body: new values only, unchanged fields
  // included, so the audit trail could say what a title became but never what it was.
  const linkedPlacementBefore = isLinkedProjectContext
    ? existing.taskProjects.find((taskProject) => taskProject.projectId === effectiveProjectId)
    : undefined
  logAudit({
    action: "update", entityType: "task", entityId: taskId, entityName: task.title,
    userId: session.user.id!, request,
    metadata: {
      projectId: effectiveProjectId,
      changes: auditDiff(
        {
          title: existing.title,
          description: existing.description,
          status: existing.status,
          priority: existing.priority,
          dueDate: existing.dueDate,
          startDate: existing.startDate,
          estimatedHours: existing.estimatedHours,
          actualHours: existing.actualHours,
          tags: existing.tags,
          isRecurring: existing.isRecurring,
          recurPattern: existing.recurPattern,
          taskType: existing.taskType,
          taskListId: isLinkedProjectContext ? linkedPlacementBefore?.taskListId ?? null : existing.taskListId,
          position: isLinkedProjectContext ? linkedPlacementBefore?.position ?? null : existing.position,
          assigneeIds: existing.assignees.map((assignee) => assignee.userId).sort(),
        },
        {
          title,
          description,
          status,
          priority,
          dueDate: dueDate === undefined ? undefined : dueDate ? new Date(dueDate) : null,
          startDate: updateData.startDate as Date | null | undefined,
          estimatedHours,
          actualHours,
          tags,
          isRecurring,
          recurPattern,
          taskType,
          taskListId,
          position,
          assigneeIds: assigneeIds === undefined ? undefined : [...assigneeIds].sort(),
        },
      ),
    },
  })

  // Automations (rebuilt 12 Oct 2026): one "task_updated" event with what actually moved, fired after
  // every write of this request (assignees included: they are rewritten further down, and the old call
  // here raced that rewrite). The engine drops fields whose value did not change.
  const previousAssigneeSet = new Set(existing.assignees.map((assignee) => assignee.userId))
  const automationChanges: Record<string, { from?: unknown; to?: unknown; added?: string[]; removed?: string[] }> = {}
  if (status !== undefined) automationChanges.status = { from: existing.status, to: status }
  if (priority !== undefined) automationChanges.priority = { from: existing.priority, to: priority }
  if (title !== undefined) automationChanges.title = { from: existing.title, to: title }
  if (description !== undefined) automationChanges.description = { from: existing.description, to: description }
  if (tags !== undefined) automationChanges.tags = { from: existing.tags, to: tags }
  if (updateData.dueDate !== undefined) automationChanges.dueDate = { from: existing.dueDate?.toISOString() ?? null, to: (updateData.dueDate as Date | null)?.toISOString() ?? null }
  if (updateData.startDate !== undefined) automationChanges.startDate = { from: existing.startDate?.toISOString() ?? null, to: (updateData.startDate as Date | null)?.toISOString() ?? null }
  // updateData.taskListId also covers the move a status change makes into a status section (TaskList.taskStatus).
  if (updateData.taskListId !== undefined) automationChanges.section = { from: existing.taskListId, to: updateData.taskListId as string }
  if (assigneeIds !== undefined) {
    const nextAssignees = new Set<string>(assigneeIds)
    automationChanges.assignee = {
      added: [...nextAssignees].filter((id) => !previousAssigneeSet.has(id)),
      removed: [...previousAssigneeSet].filter((id) => !nextAssignees.has(id)),
    }
  }
  const fireAutomations = () => {
    runAutomations({
      kind: "task_updated",
      projectId: existing.taskList.projectId,
      actorId: session.user.id!,
      taskId,
      changes: automationChanges,
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


  // The description written as text (released apps): a live block-editor room on this task reloads,
  // and the body is rebuilt from this text the next time it is opened (lib/blockdoc.ts resolveTaskBody).
  if (description !== undefined) eventBus.emit(BUS_EVENTS.COLLAB_EXTERNAL_WRITE, { key: `taskbody:${taskId}` })

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

    fireAutomations()
    return NextResponse.json(updatedTask)
  }

  const relatedProjectIds = [
    existing.taskList.projectId,
    ...existing.taskProjects.map((taskProject) => taskProject.projectId),
  ]
  for (const projectId of Array.from(new Set(relatedProjectIds))) {
    emitTaskUpdated(projectId, JSON.parse(JSON.stringify(task)))
  }

  fireAutomations()
  return NextResponse.json(task)
}
