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
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let dueDateOverride: string | null | undefined = undefined
    // Optional copy TARGET. Absent = the historical behaviour (duplicate in place, same list).
    // Present = copy into that list, which may live in a different project entirely.
    let targetListId: string | undefined = undefined
    try {
      const rawBody = await request.text()
      if (rawBody) {
        const body = JSON.parse(rawBody) as { dueDate?: unknown; taskListId?: unknown }
        if ("dueDate" in body) {
          dueDateOverride = typeof body.dueDate === "string" ? body.dueDate : null
        }
        if (typeof body.taskListId === "string" && body.taskListId) targetListId = body.taskListId
      }
    } catch {
      dueDateOverride = undefined
    }

    const existing = await prisma.task.findUnique({
      where: { id: (await params).taskId },
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

    // ── resolve the copy target ───────────────────────────────────────────────────────────────────
    // Copying INTO a project is a write there, so it needs its own MEMBER check — source access
    // must never be enough to plant tasks in a project the user can't otherwise touch.
    let destList = { id: existing.taskListId, projectId: existing.taskList.projectId }
    if (targetListId && targetListId !== existing.taskListId) {
      const target = await prisma.taskList.findUnique({
        where: { id: targetListId },
        select: { id: true, projectId: true },
      })
      if (!target) return NextResponse.json({ error: "Target list not found" }, { status: 404 })
      const targetAccess = await checkProjectAccess(session.user.id, target.projectId, ["MEMBER"])
      if (!targetAccess.allowed) {
        return NextResponse.json({ error: "Forbidden: MEMBER role or higher required in the destination project" }, { status: 403 })
      }
      destList = target
    }
    const crossProject = destList.projectId !== existing.taskList.projectId

    // Assignees only carry over if they can actually see the destination project; otherwise the copy
    // would show names that cannot open it. Dropped ones are reported back to the caller.
    let keptAssigneeIds = existing.assignees.map((a) => a.userId)
    let droppedAssignees = 0
    // Resolved once for the parent AND every subtask, so one query covers the whole copy.
    let destMemberIds = new Set<string>()
    if (crossProject) {
      const everyAssignee = Array.from(new Set([
        ...keptAssigneeIds,
        ...existing.subtasks.flatMap((s) => s.assignees.map((a) => a.userId)),
      ]))
      if (everyAssignee.length > 0) {
        const members = await prisma.projectMember.findMany({
          where: { projectId: destList.projectId, userId: { in: everyAssignee } },
          select: { userId: true },
        })
        destMemberIds = new Set(members.map((m) => m.userId))
      }
      droppedAssignees = keptAssigneeIds.filter((id) => !destMemberIds.has(id)).length
      keptAssigneeIds = keptAssigneeIds.filter((id) => destMemberIds.has(id))
    }

    // Custom fields are per-project rows, so the source's customFieldIds mean nothing in the
    // destination — writing them verbatim would attach values to ANOTHER project's fields (they'd
    // be invisible in the UI and would pollute the source project). Re-match by name + type instead.
    let fieldValuesToCopy = existing.customFieldValues
    let droppedFields: string[] = []
    if (crossProject && fieldValuesToCopy.length > 0) {
      const [srcFields, destFields] = await Promise.all([
        prisma.customField.findMany({
          where: { id: { in: fieldValuesToCopy.map((v) => v.customFieldId) } },
          select: { id: true, name: true, type: true },
        }),
        prisma.customField.findMany({
          where: { projectId: destList.projectId },
          select: { id: true, name: true, type: true },
        }),
      ])
      const srcById = new Map(srcFields.map((f) => [f.id, f]))
      const destKey = new Map(destFields.map((f) => [`${f.name.trim().toLowerCase()}|${f.type}`, f.id]))
      const remapped: typeof fieldValuesToCopy = []
      for (const v of fieldValuesToCopy) {
        const src = srcById.get(v.customFieldId)
        if (!src) continue
        const destId = destKey.get(`${src.name.trim().toLowerCase()}|${src.type}`)
        if (destId) remapped.push({ customFieldId: destId, value: v.value })
        else droppedFields.push(src.name)
      }
      fieldValuesToCopy = remapped
    }

    const maxSiblingPosition = await prisma.task.aggregate({
      where: {
        taskListId: destList.id,
        parentId: existing.parentId ?? null,
      },
      _max: {
        position: true,
      },
    })

    const duplicatedTask = await prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          // "(Copy)" only makes sense next to the original. In another project the copy IS the
          // task there, so it keeps the real name.
          title: crossProject ? existing.title : `${existing.title} (Copy)`,
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
          taskListId: destList.id,
          creatorId: session.user.id,
          // A subtask's parent lives in the source list; carrying parentId across projects would
          // strand the copy under a parent that isn't there. Cross-project copies stand alone.
          parentId: crossProject ? null : existing.parentId,
        },
      })

      if (keptAssigneeIds.length > 0) {
        await tx.taskAssignee.createMany({
          data: keptAssigneeIds.map((userId) => ({ taskId: newTask.id, userId })),
          skipDuplicates: true,
        })

        await tx.taskFollower.createMany({
          data: keptAssigneeIds.map((userId) => ({ taskId: newTask.id, userId })),
          skipDuplicates: true,
        })
      }

      if (fieldValuesToCopy.length > 0) {
        await tx.customFieldValue.createMany({
          data: fieldValuesToCopy.map((fieldValue) => ({
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

          // Same membership rule as the parent: a subtask can't be assigned to someone who has no
          // access to the destination project.
          const subAssignees = crossProject
            ? subtask.assignees.filter((a) => destMemberIds.has(a.userId))
            : subtask.assignees
          if (subAssignees.length > 0) {
            await tx.taskAssignee.createMany({
              data: subAssignees.map((assignee) => ({
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

    // Seed against the DESTINATION project so the copy gets that project's own field set (defaults
    // for anything the source didn't carry over); seeding the source's would recreate the bug the
    // remap above exists to prevent.
    await seedTaskCustomFieldValues(duplicatedTask.id, destList.projectId, duplicatedTask.createdAt)

    await prisma.activityLog.create({
      data: {
        action: crossProject ? "copied task" : "duplicated task",
        details: crossProject
          ? `Copied task "${existing.title}" from another project`
          : `Duplicated task "${existing.title}"`,
        userId: session.user.id,
        taskId: duplicatedTask.id,
        // Logged against the project the task now lives in — that's where people look for it.
        projectId: destList.projectId,
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

    // Automations belong to the project the task landed in — running the SOURCE project's rules on
    // a task that now lives elsewhere would fire the wrong side effects.
    executeAutomations(destList.projectId, "task_created", {
      taskId: duplicatedTask.id,
      userId: session.user.id,
      projectId: destList.projectId,
      assigneeIds: keptAssigneeIds,
    }).catch(() => {})

    dispatchWebhookEvent("task.created", {
      taskId: duplicatedTask.id,
      title: duplicatedTask.title,
      status: duplicatedTask.status,
      priority: duplicatedTask.priority,
      taskListId: duplicatedTask.taskListId,
      creatorId: session.user.id,
      duplicatedFrom: existing.id,
    }, destList.projectId).catch(() => {})

    emitTaskCreated(destList.projectId, JSON.parse(JSON.stringify(duplicatedTask)))

    // `copiedTo` reports what silently did NOT come along, so the UI can say so up front instead of
    // letting people discover missing fields or assignees later.
    return NextResponse.json({
      task: duplicatedTask,
      copiedTo: crossProject
        ? { projectId: destList.projectId, droppedAssignees, droppedFields }
        : null,
    }, { status: 201 })
  } catch (error) {
    console.error("Error duplicating task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
