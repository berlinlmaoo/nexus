import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { executeAutomations } from "@/lib/automation-engine"
import { emitTaskCreated } from "@/lib/socket-emitter"
import { createTaskSchema, validateBody } from "@/lib/validations"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"
import { resolveAutoAssignAssigneeIds } from "@/lib/project-auto-assign"
import { notifyTaskAssigned } from "@/lib/notification-service"
import type { TaskUpdateSession } from "@/lib/task-update"

/**
 * One task create (the body of POST /api/tasks, validated by createTaskSchema): Can edit check, subtask parent and
 * depth rules, auto-assign (assignees narrowed to project members), placement, custom-field seeding, activity log,
 * assignment notifications, audit, automations and the `task-created` realtime event. Moved here verbatim from the
 * POST route (17 Nov 2026) so the MCP server creates tasks through exactly the same rules instead of its own copy.
 * The caller authenticates and rate-limits; errors thrown here are the caller's to turn into a 500.
 * `auditMetadata`: extra keys on the audit row (the MCP server names the connection: "via Silk (MCP)").
 */
export async function applyTaskCreate({
  request,
  session,
  body,
  auditMetadata,
}: {
  request: NextRequest
  session: TaskUpdateSession
  body: unknown
  auditMetadata?: Record<string, unknown>
}): Promise<NextResponse> {
  const validation = validateBody(createTaskSchema, body)
  if (!validation.success) return validation.error

  const { title, description, status, priority, taskListId, dueDate, startDate, estimatedHours, tags, assigneeIds, parentId, placement } =
    validation.data
  // Validated by createTaskSchema but never written before. Same handling as PATCH /api/tasks/{id}:
  // "YYYY-MM-DD" or ISO, 400 on an unparseable date.
  const parsedStart = startDate ? new Date(startDate) : null
  if (parsedStart && Number.isNaN(parsedStart.getTime())) {
    return NextResponse.json({ error: "Invalid start date" }, { status: 400 })
  }

  const taskList = await prisma.taskList.findUnique({
    where: { id: taskListId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          autoAssignEnabled: true,
          autoAssignAssigneeIds: true,
          members: {
            select: {
              userId: true,
            },
          },
        },
      },
    },
  })

  if (!taskList) {
    return NextResponse.json({ error: "TaskList not found" }, { status: 404 })
  }

  const { allowed } = await checkProjectAccess(session.user.id!, taskList.projectId, ["MEMBER"])
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden: you need Can edit access in this project", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
  }

  // Subtask parent must be a task in the SAME project (an unvalidated parentId could attach a
  // subtask onto any workspace's task — content injection into a panel you can't even open).
  // Depth is capped Asana-style: max 5 levels of nesting.
  if (parentId) {
    const parent = await prisma.task.findUnique({
      where: { id: parentId },
      select: { id: true, parentId: true, taskList: { select: { projectId: true } } },
    })
    if (!parent || parent.taskList.projectId !== taskList.projectId) {
      return NextResponse.json({ error: "Parent task not found in this project" }, { status: 400 })
    }
    let depth = 1
    let cursor = parent.parentId
    while (cursor && depth < 5) {
      const up: { parentId: string | null } | null = await prisma.task.findUnique({ where: { id: cursor }, select: { parentId: true } })
      cursor = up?.parentId ?? null
      depth++
    }
    if (depth >= 5) {
      return NextResponse.json({ error: "Maximum subtask depth (5) reached" }, { status: 400 })
    }
  }

  const finalAssigneeIds = resolveAutoAssignAssigneeIds({
    requestedAssigneeIds: assigneeIds,
    autoAssignEnabled: taskList.project.autoAssignEnabled,
    autoAssignAssigneeIds: taskList.project.autoAssignAssigneeIds,
    validProjectMemberIds: taskList.project.members.map((member) => member.userId),
  })

  const userId = session.user.id!

  // `placement` (web, 12 Oct 2026): above / below every task already in the section.
  let position: number | undefined
  if (placement) {
    const agg = await prisma.task.aggregate({ where: { taskListId, parentId: null }, _min: { position: true }, _max: { position: true } })
    position = placement === "top" ? (agg._min.position ?? 0) - 1 : (agg._max.position ?? -1) + 1
  }

  const task = await prisma.task.create({
    data: {
      title,
      description,
      // A section that stands for a status (project templates, TaskList.taskStatus) gives a new task
      // that status unless the request names one: "+ Add" in "Published" makes a published item.
      status: status || taskList.taskStatus || undefined,
      priority: priority || undefined,
      taskListId,
      ...(position !== undefined ? { position } : {}),
      creatorId: userId,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      startDate: parsedStart ?? undefined,
      estimatedHours: estimatedHours ?? undefined,
      tags: tags || [],
      parentId,
      assignees: finalAssigneeIds.length
        ? {
            create: finalAssigneeIds.map((uid: string) => ({ userId: uid })),
          }
        : undefined,
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

  await seedTaskCustomFieldValues(task.id, taskList.projectId, task.createdAt)

  await prisma.activityLog.create({
    data: {
      action: "created task",
      details: `Created task "${title}"`,
      userId,
      taskId: task.id,
      projectId: taskList.projectId,
    },
  })

  await Promise.all(finalAssigneeIds.map((assigneeId) =>
    notifyTaskAssigned({
      assigneeId,
      taskId: task.id,
      taskTitle: task.title,
      projectName: taskList.project.name,
      projectId: taskList.projectId,
      assignedByName: session.user.name || "Someone",
      actorId: userId,
    })
  ))

  logAudit({ action: "create", entityType: "task", entityId: task.id, entityName: title, userId, request, ...(auditMetadata ? { metadata: auditMetadata } : {}) })

  // Fire automations (non-blocking)
  executeAutomations(taskList.projectId, "task_created", {
    taskId: task.id,
    userId,
    projectId: taskList.projectId,
    assigneeIds: finalAssigneeIds,
  }).catch(() => {})


  // Real-time: broadcast to project room
  // The seeded custom field values travel with the event (additive), so an open board can add the card
  // as it is without refetching the whole project (realtime bug 5, 13 Oct 2026). The response is unchanged.
  const customFieldValues = await prisma.customFieldValue.findMany({ where: { taskId: task.id }, select: { customFieldId: true, value: true } }).catch(() => null)
  emitTaskCreated(taskList.projectId, JSON.parse(JSON.stringify(customFieldValues ? { ...task, customFieldValues } : task)))

  return NextResponse.json(task, { status: 201 })
}
