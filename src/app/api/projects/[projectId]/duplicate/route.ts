export const dynamic = "force-dynamic"

import type { InputJsonValue } from "@prisma/client/runtime/client"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { ensureSheetFormattingColumns } from "@/lib/project-sheets"
import { copySheet } from "@/lib/sheet-structure"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { logAudit } from "@/lib/audit"
import { syncProjectRoomSafe } from "@/lib/chat-membership"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"

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

    await ensureSheetFormattingColumns()
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
    // A copy of the Pipeline board would be a second pipeline; there is one for the whole company
    // (owner/GM, 9 Oct 2026). POST /api/projects refuses it the same way.
    if (original.type === "PIPELINE") {
      return NextResponse.json(
        { error: "Pipeline perusahaan cuma satu, tidak bisa disalin.", code: "PIPELINE_EXISTS", projectId: original.id, projectName: original.name },
        { status: 409 },
      )
    }

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
        // Per-project behaviour toggles (the retired ones in lib/project-retired-flags.ts are not copied) — a copy that silently loses these isn't a copy.
        autoAssignEnabled: original.autoAssignEnabled,
        autoAssignAssigneeIds: original.autoAssignAssigneeIds,
        // Type and tabs (9 Oct 2026) — the copy looks like the original.
        type: original.type,
        hiddenTabs: original.hiddenTabs,
        // The template it came from (12 Oct 2026): the copy opens and plots like the original.
        templateId: original.templateId,
        // A Social Media Report's platforms (14 Oct 2026); figures and targets are not copied.
        ...(original.socialReportConfig != null && { socialReportConfig: original.socialReportConfig as InputJsonValue }),
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
    await syncProjectRoomSafe(newProject.id, "project-duplicated")

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

    // Spreadsheets: column ids live inside each sheet's own `columns` json and are the keys in its
    // rows' `cells`, so unlike tableColumns' "cf:<id>" they need no remap. The easy mistake is copying
    // the sheet but not its ROWS, which silently hands the duplicate an empty spreadsheet.
    // Rows get new ids, so copySheet also rewrites every formula's row references to the copies
    // (copying the stored text as-is left them pointing at the original project's rows: #REF!).
    for (const sheet of original.sheets) {
      await copySheet(sheet.id, { projectId: newProject.id, name: sheet.name, position: sheet.position, createdById: me })
    }

    const sectionIdMap = new Map<string, string>()
    for (const taskList of original.taskLists) {
      const newTaskList = await prisma.taskList.create({
        data: { name: taskList.name, position: taskList.position, taskStatus: taskList.taskStatus, projectId: newProject.id },
      })
      sectionIdMap.set(taskList.id, newTaskList.id)

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

        // The block-editor body comes along (its text is the description copied above).
        const body = await prisma.taskBody.findUnique({ where: { taskId: task.id }, select: { doc: true } })
        if (body) await prisma.taskBody.create({ data: { taskId: newTask.id, doc: body.doc as unknown as InputJsonValue, updatedById: me } })

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

    // Saved views (owner, 12 Oct 2026): the SHARED ones come along (personal views stay with their owner's
    // copy of the original). Their config names custom fields ("cf:<id>") and sections by id, so every old
    // id is swapped for the copy's; a rule naming something that did not come across just stops matching.
    const sharedViews = await prisma.projectView.findMany({ where: { projectId, ownerId: null }, orderBy: { position: "asc" } })
    if (sharedViews.length) {
      const swap = (json: unknown) => {
        let text = JSON.stringify(json ?? {})
        for (const [from, to] of [...fieldIdMap, ...sectionIdMap]) text = text.split(from).join(to)
        return JSON.parse(text) as object
      }
      await prisma.projectView.createMany({
        data: sharedViews.map((v) => ({ projectId: newProject.id, name: v.name, layout: v.layout, builtin: v.builtin, position: v.position, config: swap(v.config), ownerId: null, createdById: me })),
        skipDuplicates: true,
      })
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

    // The copy, complete with its tasks, appears live beside the original for the workspace and its members.
    emitWorkspaceChanged(
      original.workspaceId,
      { kind: "projects", projectId: newProject.id, folderId: original.folderId ?? undefined, actorId: me },
      memberRows.map((m) => m.userId),
    )

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
