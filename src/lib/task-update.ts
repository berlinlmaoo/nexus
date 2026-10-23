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
import { flushLiveRoom } from "@/lib/collab-rooms"
import { resolveLegacyId } from "@/lib/legacy-ids"
import type { Prisma } from "@/generated/prisma/client"

/** Same set of ids, order and repeats ignored. */
const sameIdSet = (a: readonly string[], b: readonly string[]) => {
  const x = new Set(a), y = new Set(b)
  return x.size === y.size && [...x].every((id) => y.has(id))
}

/** The task row lock every list writer of a task takes first (assignees, tags — race audit 16 Oct 2026). */
async function lockTaskRow(tx: Prisma.TransactionClient, taskId: string) {
  await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`
}

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
    taskListId: rawTaskListId,
    position,
    assigneeIds,
    addAssigneeIds,
    removeAssigneeIds,
    baseAssigneeIds,
    addTags,
    removeTags,
    isRecurring,
    recurPattern,
    taskType,
  } = validation.data
  // Old section ids (pre-UUIDv7) are read as the converted ones, so the stored row and the socket payload agree.
  const taskListId = rawTaskListId ? await resolveLegacyId(rawTaskListId) : rawTaskListId
  // May be set below from the section the task moves into (TaskList.taskStatus, project templates).
  let status = requestedStatus

  // The description written as text (released apps) while someone types in the block editor: what they typed
  // and the room has not saved yet is stored first, and kept in this edit's audit row (race audit H9).
  const liveFlush = description !== undefined ? await flushLiveRoom(`taskbody:${taskId}`) : null

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

  // A client still holding a pre-UUIDv7 project id (released app opened before the id conversion) sends it as
  // the context: compare against the converted id, or every move would read as "not linked to this project".
  const effectiveProjectId = projectContextId ? await resolveLegacyId(projectContextId) : existing.taskList.projectId

  const { allowed } = await checkProjectAccess(session.user.id!, effectiveProjectId, ["MEMBER"])
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden: you need Can edit access in this project", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
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

  // ── Assignees (race audit 16 Oct 2026, H8). The list used to be replaced with deleteMany + createMany outside
  // any transaction: 20 replacements at once answered 6 × 500 (unique violation) and left TWO assignees where a
  // sequential run leaves one. Now one transaction with the task row locked: the list stored NOW is read, the
  // request is applied to it (a whole `assigneeIds`, and/or `addAssigneeIds` / `removeAssigneeIds`), and only
  // the difference is written. `baseAssigneeIds` (the list the client saw) that no longer matches → 409, and
  // nothing of this request is written. Runs before every other write of the request for that reason.
  const assigneesTouched = assigneeIds !== undefined || addAssigneeIds !== undefined || removeAssigneeIds !== undefined
  let assigneeDiff: { before: string[]; after: string[]; added: string[]; removed: string[] } | null = null
  if (assigneesTouched) {
    const outcome = await prisma.$transaction(async (tx) => {
      await lockTaskRow(tx, taskId)
      const before = (await tx.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })).map((a) => a.userId)
      if (baseAssigneeIds !== undefined && !sameIdSet(baseAssigneeIds, before)) return { conflict: before }
      let after = assigneeIds !== undefined ? [...new Set(assigneeIds)] : [...before]
      for (const id of addAssigneeIds ?? []) if (!after.includes(id)) after.push(id)
      if (removeAssigneeIds?.length) after = after.filter((id) => !removeAssigneeIds.includes(id))
      const added = after.filter((id) => !before.includes(id))
      const removed = before.filter((id) => !after.includes(id))
      if (removed.length) await tx.taskAssignee.deleteMany({ where: { taskId, userId: { in: removed } } })
      if (added.length) {
        await tx.taskAssignee.createMany({ data: added.map((userId) => ({ taskId, userId })), skipDuplicates: true })
        // Auto-follow: assigned users follow the task.
        await tx.taskFollower.createMany({ data: added.map((userId) => ({ taskId, userId })), skipDuplicates: true })
      }
      return { before, after, added, removed }
    })
    if ("conflict" in outcome) {
      return NextResponse.json(
        { error: "The assignees of this task were changed by someone else. Check them and try again.", code: "ASSIGNEES_CHANGED", assigneeIds: outcome.conflict },
        { status: 409 },
      )
    }
    assigneeDiff = outcome
  }

  // ── Completion (race audit 16 Oct 2026, M11). "Was it DONE before?" was read once at the top: 20 "mark done"
  // at once each saw TODO, and a DAILY recurring task got 17 next occurrences (and 17 activity rows, streak
  // bumps, completion notifications). Now the transition is CLAIMED: one conditional UPDATE … WHERE status <>
  // DONE; only the request that flips it runs the side effects. The others still apply their other fields.
  let becameDone = false
  if (status === "DONE" && existing.status !== "DONE") {
    const claim = await prisma.task.updateMany({ where: { id: taskId, status: { not: "DONE" } }, data: { status: "DONE", completedById: session.user.id } })
    becameDone = claim.count === 1
    if (!becameDone) delete updateData.completedById
  }
  const statusChanged = status !== undefined && status !== existing.status && (status !== "DONE" || becameDone)

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

  // Tags added / removed relative to what is stored now (race audit M13): the whole list sent from a client's
  // copy (released apps, `tags`) kept 1 of 20 tags added at once. Read and written under the task row lock.
  const tagOps = addTags !== undefined || removeTags !== undefined
  let tagsBefore: string[] = existing.tags
  const taskInclude = {
    assignees: { include: { user: true } },
    creator: true,
    taskList: true,
    _count: { select: { subtasks: true, comments: true } },
  } as const
  if (tagOps) {
    const outcome = await prisma.$transaction(async (tx) => {
      await lockTaskRow(tx, taskId)
      const fresh = await tx.task.findUnique({ where: { id: taskId }, select: { tags: true } })
      const before = fresh?.tags ?? []
      let next = tags !== undefined ? [...tags] : [...before]
      for (const tag of addTags ?? []) if (!next.includes(tag)) next.push(tag)
      if (removeTags?.length) next = next.filter((tag) => !removeTags.includes(tag))
      if (next.length > 20) return { tooMany: true as const }
      const row = await tx.task.update({ where: { id: taskId }, data: { ...updateData, tags: next }, include: taskInclude })
      return { before, next, row }
    })
    if ("tooMany" in outcome) {
      return NextResponse.json({ error: "A task can have at most 20 tags.", code: "TOO_MANY_TAGS" }, { status: 400 })
    }
    tagsBefore = outcome.before
    updateData.tags = outcome.next
    task = outcome.row
  } else if (Object.keys(updateData).length > 0) {
    task = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: taskInclude,
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

  if (statusChanged) {
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
  if (becameDone) {
    try {
      await bumpStreak(session.user.id!)
    } catch (xpErr) {
      console.error("streak bump (task done) failed:", xpErr)
    }
  }

  // Auto-create next occurrence for recurring tasks completed
  if (becameDone && existing.isRecurring && existing.recurPattern) {
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
          tags: tagsBefore,
          isRecurring: existing.isRecurring,
          recurPattern: existing.recurPattern,
          taskType: existing.taskType,
          taskListId: isLinkedProjectContext ? linkedPlacementBefore?.taskListId ?? null : existing.taskListId,
          position: isLinkedProjectContext ? linkedPlacementBefore?.position ?? null : existing.position,
          assigneeIds: (assigneeDiff?.before ?? existing.assignees.map((assignee) => assignee.userId)).sort(),
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
          tags: updateData.tags as string[] | undefined,
          isRecurring,
          recurPattern,
          taskType,
          taskListId,
          position,
          assigneeIds: assigneeDiff ? [...assigneeDiff.after].sort() : undefined,
        },
      ),
      ...(liveFlush?.flushed && liveFlush.replaced ? { replacedLiveText: liveFlush.replaced } : {}),
    },
  })

  // Automations (rebuilt 12 Oct 2026): one "task_updated" event with what actually moved, fired after
  // every write of this request (assignees included: they are rewritten further down, and the old call
  // here raced that rewrite). The engine drops fields whose value did not change.
  const automationChanges: Record<string, { from?: unknown; to?: unknown; added?: string[]; removed?: string[] }> = {}
  if (status !== undefined) automationChanges.status = { from: existing.status, to: status }
  if (priority !== undefined) automationChanges.priority = { from: existing.priority, to: priority }
  if (title !== undefined) automationChanges.title = { from: existing.title, to: title }
  if (description !== undefined) automationChanges.description = { from: existing.description, to: description }
  if (updateData.tags !== undefined) automationChanges.tags = { from: tagsBefore, to: updateData.tags }
  if (updateData.dueDate !== undefined) automationChanges.dueDate = { from: existing.dueDate?.toISOString() ?? null, to: (updateData.dueDate as Date | null)?.toISOString() ?? null }
  if (updateData.startDate !== undefined) automationChanges.startDate = { from: existing.startDate?.toISOString() ?? null, to: (updateData.startDate as Date | null)?.toISOString() ?? null }
  // updateData.taskListId also covers the move a status change makes into a status section (TaskList.taskStatus).
  if (updateData.taskListId !== undefined) automationChanges.section = { from: existing.taskListId, to: updateData.taskListId as string }
  if (assigneeDiff) automationChanges.assignee = { added: assigneeDiff.added, removed: assigneeDiff.removed }
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
  if (becameDone) {
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

  if (assigneeDiff) {
    // Written above, in the locked transaction; here only who is NEW is told (once, whatever ran at once).
    await Promise.allSettled(assigneeDiff.added.map((assigneeId: string) => notifyTaskAssigned({
      assigneeId,
      taskId,
      taskTitle: task.title,
      projectName: existing.taskList.project.name,
      projectId: effectiveProjectId,
      assignedByName: session.user.name || "Someone",
      actorId: session.user.id,
    })))

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
  // The row as it is NOW, not as this request wrote it (race audit 16 Oct 2026, M20): the side effects
  // above take a while, and a concurrent edit that committed and announced itself meanwhile would otherwise
  // be overwritten on every open board by this older snapshot arriving last. Web skips an event older
  // (updatedAt) than what it holds (apps/web/src/lib/task-cache.ts).
  const announced = Object.keys(updateData).length > 0
    ? (await prisma.task.findUnique({
        where: { id: taskId },
        include: { assignees: { include: { user: true } }, creator: true, taskList: true, _count: { select: { subtasks: true, comments: true } } },
      }).catch(() => null)) ?? task
    : task
  for (const projectId of Array.from(new Set(relatedProjectIds))) {
    emitTaskUpdated(projectId, JSON.parse(JSON.stringify(announced)))
  }

  fireAutomations()
  return NextResponse.json(task)
}
