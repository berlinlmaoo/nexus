export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { logAudit } from "@/lib/audit"

// POST /api/projects/[projectId]/duplicate
//
// Copies a project into a new one. **BoD and above only** (ORG role, not project role): duplicating
// clones every task, assignee and member at once, so it shapes the workspace rather than being
// project housekeeping. The caller must also still be able to see the source project.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const { projectId } = await params

    if (!isBodPlus(await getUserOrgRole(me))) {
      return NextResponse.json({ error: "Cuma BoD ke atas yang boleh nyalin project." }, { status: 403 })
    }
    const { allowed } = await checkProjectAccess(me, projectId, ["VIEWER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const original = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        taskLists: {
          orderBy: { position: "asc" },
          include: {
            tasks: {
              include: {
                assignees: { select: { userId: true } },
                customFieldValues: { select: { customFieldId: true, value: true } },
              },
            },
          },
        },
        members: { select: { userId: true, role: true } },
        customFields: { orderBy: { position: "asc" } },
        sheets: { orderBy: { position: "asc" } },
      },
    })
    if (!original) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const newProject = await prisma.project.create({
      data: {
        name: `Copy of ${original.name}`,
        description: original.description,
        color: original.color,
        icon: original.icon,
        status: original.status,
        workspaceId: original.workspaceId,
        // Land beside the original instead of at the sidebar root.
        folderId: original.folderId,
        // Per-project behaviour toggles — a copy that silently loses these isn't a copy.
        enableTaskBatchDuplicate: original.enableTaskBatchDuplicate,
        autoAssignEnabled: original.autoAssignEnabled,
        autoAssignAssigneeIds: original.autoAssignAssigneeIds,
        enablePnlDashboard: original.enablePnlDashboard,
        requireAttachmentForDone: original.requireAttachmentForDone,
        disableTaskStatus: original.disableTaskStatus,
      },
    })

    // Members: keep everyone, and make sure the duplicator can actually open the result.
    const memberRows = original.members.map((m) => ({
      projectId: newProject.id,
      userId: m.userId,
      role: m.userId === me ? ("LEAD" as const) : m.role,
    }))
    if (!memberRows.some((m) => m.userId === me)) {
      memberRows.push({ projectId: newProject.id, userId: me, role: "LEAD" as const })
    }
    await prisma.projectMember.createMany({ data: memberRows, skipDuplicates: true })

    // Custom fields, keeping old id -> new id so task values and tableColumns can be remapped.
    const fieldIdMap = new Map<string, string>()
    for (const cf of original.customFields) {
      const created = await prisma.customField.create({
        data: {
          name: cf.name,
          type: cf.type,
          options: cf.options ?? undefined,
          position: cf.position,
          projectId: newProject.id,
        },
        select: { id: true },
      })
      fieldIdMap.set(cf.id, created.id)
    }

    // tableColumns stores custom fields as "cf:<id>", so it has to be rewritten — copied verbatim it
    // would point the new project's Table view at the ORIGINAL project's columns.
    if (Array.isArray(original.tableColumns)) {
      const remapped = (original.tableColumns as unknown[])
        .map((c) => {
          const key = String(c)
          if (!key.startsWith("cf:")) return key
          const mapped = fieldIdMap.get(key.slice(3))
          return mapped ? `cf:${mapped}` : null
        })
        .filter((c): c is string => Boolean(c))
      await prisma.project.update({ where: { id: newProject.id }, data: { tableColumns: remapped } })
    }

    // Spreadsheets copy 1:1 — column ids live inside each sheet's own `columns` json and are the keys
    // in its rows' `cells`, so unlike tableColumns' "cf:<id>" there is nothing to remap. The easy
    // mistake here is the opposite one: copying the sheet but not its ROWS, which silently hands the
    // duplicate an empty spreadsheet.
    for (const sheet of original.sheets) {
      const copy = await prisma.projectSheet.create({
        data: {
          projectId: newProject.id,
          name: sheet.name,
          position: sheet.position,
          columns: (sheet.columns ?? []) as object,
          createdById: me,
        },
        select: { id: true },
      })
      const sheetRows = await prisma.sheetRow.findMany({
        where: { sheetId: sheet.id },
        orderBy: { position: "asc" },
        select: { position: true, cells: true, height: true },
      })
      if (sheetRows.length) {
        await prisma.sheetRow.createMany({
          data: sheetRows.map((r) => ({ sheetId: copy.id, position: r.position, cells: (r.cells ?? {}) as object, height: r.height })),
        })
      }
    }

    for (const taskList of original.taskLists) {
      const newTaskList = await prisma.taskList.create({
        data: { name: taskList.name, position: taskList.position, projectId: newProject.id },
      })

      for (const task of taskList.tasks) {
        const newTask = await prisma.task.create({
          data: {
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            position: task.position,
            dueDate: task.dueDate,
            tags: task.tags,
            estimatedHours: task.estimatedHours,
            taskType: task.taskType,
            startDate: task.startDate,
            isRecurring: task.isRecurring,
            recurPattern: task.recurPattern as object | undefined,
            taskListId: newTaskList.id,
            creatorId: me,
          },
          select: { id: true },
        })

        if (task.assignees.length > 0) {
          await prisma.taskAssignee.createMany({
            data: task.assignees.map((a) => ({ taskId: newTask.id, userId: a.userId })),
            skipDuplicates: true,
          })
        }

        // Custom field values follow their remapped field. A value whose field didn't come across is
        // dropped rather than left pointing at the source project's field.
        const values = task.customFieldValues
          .map((v) => ({ customFieldId: fieldIdMap.get(v.customFieldId), taskId: newTask.id, value: v.value }))
          .filter((v): v is { customFieldId: string; taskId: string; value: string } => Boolean(v.customFieldId))
        if (values.length) await prisma.customFieldValue.createMany({ data: values, skipDuplicates: true })
      }
    }

    logAudit({
      action: "create",
      entityType: "project",
      entityId: newProject.id,
      entityName: newProject.name,
      userId: me,
      request,
      metadata: { duplicatedFrom: projectId },
    })

    const result = await prisma.project.findUnique({
      where: { id: newProject.id },
      include: {
        taskLists: {
          include: { tasks: { include: { assignees: { include: { user: true } } } } },
          orderBy: { position: "asc" },
        },
        members: { include: { user: true } },
      },
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("Error duplicating project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
