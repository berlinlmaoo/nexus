/**
 * Build a project from a template (owner, 12 Oct 2026; registry in lib/project-templates.ts).
 *
 * One transaction: the project with its members and sections, its custom fields, the Table columns
 * (template field keys swapped for the new field ids), the starter pages and tasks. Either all of it
 * exists afterwards or none of it does, so a failure never leaves a half-built project in the sidebar.
 * POST /api/projects calls this when the body names a templateId; everything after the create (chat
 * room, realtime ping, invite notifications, default sheet) is the same as for a blank project.
 */
import type { Prisma } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { planTemplate, type ProjectTemplate, type TemplateLang } from "@/lib/project-templates"
import { roleForLevel, type AccessLevel } from "@/lib/rbac"

export interface TemplateCreateInput {
  template: ProjectTemplate
  lang: TemplateLang
  /** Starter pages / tasks (the dialog's "Add starter pages"); on unless the client says false. */
  starter: boolean
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  workspaceId: string
  folderId?: string | null
  hiddenTabs: string[]
  userId: string
  memberIds: string[]
  /** Access level for memberIds (the New project dialog's dropdown); EDIT when absent. */
  memberLevel?: AccessLevel
}

export async function createProjectFromTemplate(input: TemplateCreateInput) {
  const plan = planTemplate(input.template, input.lang, input.starter)
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: input.name,
        description: input.description ?? undefined,
        color: input.color || input.template.color,
        ...(input.icon ? { icon: input.icon } : {}),
        type: "TASK",
        templateId: input.template.id,
        workspaceId: input.workspaceId,
        ...(input.folderId ? { folderId: input.folderId } : {}),
        hiddenTabs: input.hiddenTabs,
        members: {
          create: [
            { userId: input.userId, role: "LEAD", accessLevel: "FULL" },
            ...input.memberIds.map((memberId) => ({ userId: memberId, role: roleForLevel(input.memberLevel ?? "EDIT"), accessLevel: input.memberLevel ?? "EDIT" })),
          ],
        },
        taskLists: {
          create: plan.sections.map((s) => ({ name: s.name, position: s.position, taskStatus: s.taskStatus })),
        },
      },
      select: { id: true, taskLists: { select: { id: true, position: true, taskStatus: true }, orderBy: { position: "asc" } } },
    })

    const fieldIds = new Map<string, string>()
    for (const f of plan.fields) {
      const field = await tx.customField.create({
        data: {
          name: f.name,
          type: f.type,
          position: f.position,
          projectId: project.id,
          ...(f.options ? { options: f.options as Prisma.InputJsonValue } : {}),
        },
        select: { id: true },
      })
      fieldIds.set(f.key, field.id)
    }

    const tableColumns = plan.tableColumns
      .map((c) => (c.startsWith("cf:") ? (fieldIds.has(c.slice(3)) ? `cf:${fieldIds.get(c.slice(3))}` : null) : c))
      .filter((c): c is string => !!c)
    await tx.project.update({ where: { id: project.id }, data: { tableColumns } })

    for (const [i, d] of plan.docs.entries()) {
      await tx.doc.create({
        data: {
          title: d.title,
          content: d.content as Prisma.InputJsonValue,
          contentText: d.contentText,
          icon: d.icon,
          position: i,
          projectId: project.id,
          authorId: input.userId,
          ownerId: input.userId,
        },
      })
    }

    for (const [i, task] of plan.tasks.entries()) {
      const list = project.taskLists[task.section] ?? project.taskLists[0]
      await tx.task.create({
        data: {
          title: task.title,
          description: task.description,
          position: i,
          taskListId: list.id,
          creatorId: input.userId,
          ...(list.taskStatus ? { status: list.taskStatus } : {}),
        },
      })
    }

    // Same shape POST /api/projects has always answered with.
    return tx.project.findUniqueOrThrow({
      where: { id: project.id },
      include: { members: { include: { user: true } }, taskLists: true, pages: true },
    })
  })
}
