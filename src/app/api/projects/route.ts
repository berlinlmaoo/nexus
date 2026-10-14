export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess, isSystemAdminUser, isAccessLevel, roleForLevel, type AccessLevel } from "@/lib/rbac"
import { ensureProjectSheet } from "@/lib/project-sheets"
import { syncProjectRoomSafe } from "@/lib/chat-membership"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { checkCreatableProjectType, DEFAULT_HIDDEN_TABS_NEW_TASK_PROJECT, normalizeHiddenTabs } from "@/lib/project-tabs"
import { notifyProjectInvite } from "@/lib/notification-service"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { findProjectTemplate, templateHiddenTabs, templateLang } from "@/lib/project-templates"
import { createProjectFromTemplate } from "@/lib/project-template-apply"
import { hasProjectWideAccess } from "@/lib/rbac"

const projectListSelect = {
  id: true,
  name: true,
  description: true,
  color: true,
  icon: true,
  status: true,
  // Additive (9 Oct 2026): "TASK" for every project today; lets a list badge other types later.
  type: true,
  workspaceId: true,
  folderId: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      members: true,
      taskLists: true,
    },
  },
  taskLists: {
    select: {
      id: true,
      _count: {
        select: { tasks: true },
      },
    },
  },
  members: {
    select: {
      id: true,
      role: true,
      userId: true,
      projectId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
    },
  },
} as const

function isMissingSchemaError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2021" || error.code === "P2022")
}

async function canManageTeamInWorkspace(userId: string, workspaceId: string, teamId?: string) {
  if (!teamId) return false

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      workspaceId: true,
      members: {
        where: { userId },
        select: { id: true },
      },
    },
  })

  return Boolean(team && team.workspaceId === workspaceId && team.members.length > 0)
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)

    const workspaceId = request.nextUrl.searchParams.get("workspaceId")
    const includeAllWorkspace = request.nextUrl.searchParams.get("includeAllWorkspace") === "1"
    const teamId = request.nextUrl.searchParams.get("teamId") || undefined

    if (workspaceId) {
      if (isSystemAdmin) {
        const projects = await prisma.project.findMany({
          where: { workspaceId },
          select: projectListSelect,
          orderBy: { createdAt: "desc" },
        })

        const result = await withTaskCounts(projects)

        return NextResponse.json(result)
      }

      const workspaceMembership = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: session.user.id,
            workspaceId,
          },
        },
        select: { role: true },
      })

      if (!workspaceMembership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const canSeeAllWorkspaceProjects =
        hasProjectWideAccess(workspaceMembership.role) ||
        await canManageTeamInWorkspace(session.user.id, workspaceId, teamId)

      const where: Record<string, unknown> = {
        workspaceId,
      }

      if (!includeAllWorkspace || !canSeeAllWorkspaceProjects) {
        where.members = {
          some: { userId: session.user.id },
        }
      } else {
        // The pipeline board shows only to its own members, whatever the viewer's rank (owner, 9 Oct 2026).
        where.OR = [{ type: { not: "PIPELINE" } }, { members: { some: { userId: session.user.id } } }]
      }

      const projects = await prisma.project.findMany({
        where,
        select: projectListSelect,
        orderBy: { createdAt: "desc" },
      })

      const result = await withTaskCounts(projects)

      return NextResponse.json(result)
    }

    const workspaceMemberships = await prisma.workspaceMember.findMany({
      where: { userId: session.user.id },
      select: { workspaceId: true, role: true },
    })

    const adminWorkspaceIds = workspaceMemberships
      .filter((membership) => hasProjectWideAccess(membership.role)) // BoD / One Above All (owner 13 Oct 2026)
      .map((membership) => membership.workspaceId)

    const memberWorkspaceIds = workspaceMemberships
      .filter((membership) => !hasProjectWideAccess(membership.role)) // Manager + Staff: member projects only
      .map((membership) => membership.workspaceId)

    const whereScopes: Record<string, unknown>[] = []

    if (adminWorkspaceIds.length > 0) {
      whereScopes.push({ workspaceId: { in: adminWorkspaceIds } })
    }

    if (memberWorkspaceIds.length > 0) {
      whereScopes.push({
        workspaceId: { in: memberWorkspaceIds },
        members: {
          some: { userId: session.user.id },
        },
      })
    }

    if (whereScopes.length === 0) {
      if (!isSystemAdmin) {
        return NextResponse.json([])
      }
    }

    const scoped: Record<string, unknown> = isSystemAdmin
      ? {}
      : whereScopes.length === 1
        ? whereScopes[0]
        : { OR: whereScopes }
    // The pipeline board shows only to its own members, whatever the viewer's rank (owner, 9 Oct 2026).
    const where: Record<string, unknown> = isSystemAdmin
      ? { ...scoped }
      : { AND: [scoped, { OR: [{ type: { not: "PIPELINE" } }, { members: { some: { userId: session.user.id } } }] }] }

    const projects = await prisma.project.findMany({
      where,
      select: projectListSelect,
      orderBy: { createdAt: "desc" },
    })

    const result = await withTaskCounts(projects)

    return NextResponse.json(result)
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json([])
    }

    console.error("Error fetching projects:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

const MAX_INITIAL_MEMBERS = 200

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { name, description, color, icon, workspaceId, folderId } = body

    if (!name || !workspaceId) {
      return NextResponse.json({ error: "Name and workspaceId are required" }, { status: 400 })
    }

    // Project type (owner, 9 Oct 2026). No type = a Task Project, which is what every client before
    // this sends. Pipeline Dashboard (9 Oct) and Outlet Sales Dashboard (10 Oct 2026) can be created;
    // Finance Dashboard and Content Planner cannot (lib/project-tabs.ts). An Outlet Sales project gets the
    // three default sections below too, so an app that does not know the type opens it as an empty task
    // project instead of failing — as for the pipeline.
    const typeCheck = checkCreatableProjectType(body.type)
    if (!typeCheck.ok) {
      return NextResponse.json({ error: typeCheck.error, code: typeCheck.code }, { status: 400 })
    }

    // A template (owner, 12 Oct 2026; lib/project-templates.ts) builds a Task Project with its sections,
    // fields, tabs, Table columns and starter pages. Only TASK: the other types have fixed views.
    let template: ReturnType<typeof findProjectTemplate> = null
    if (body.templateId !== undefined && body.templateId !== null && body.templateId !== "") {
      template = findProjectTemplate(body.templateId)
      if (!template) {
        return NextResponse.json({ error: "Template tidak dikenal.", code: "UNKNOWN_TEMPLATE" }, { status: 400 })
      }
      if (typeCheck.type !== "TASK") {
        return NextResponse.json({ error: "Template hanya untuk Task Project.", code: "TEMPLATE_TASK_ONLY" }, { status: 400 })
      }
    }

    const userId = session.user.id

    // Verify the user is a member of the target workspace
    const workspaceMembership = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    })
    if (!workspaceMembership) {
      return NextResponse.json({ error: "Forbidden: you are not a member of this workspace" }, { status: 403 })
    }

    // A Pipeline board lives in the company workspace. Any number of them (owner, 11 Oct 2026: a new
    // pipeline starts empty, it does not open the existing "Pipeline Z Networks" — the one-board rule of
    // 9 Oct is gone). Deal codes TZN-YYNNN stay unique across all boards.
    if (typeCheck.type === "PIPELINE") {
      if (workspaceId !== ORG_WORKSPACE_ID) {
        return NextResponse.json(
          { error: "Pipeline Dashboard hanya ada di workspace perusahaan.", code: "PIPELINE_COMPANY_ONLY" },
          { status: 400 },
        )
      }
    }

    // Set up in the create dialog (owner, 11 Oct 2026). Both optional.
    //  - hiddenTabs: the tabs a TASK project starts without, same keys and rule as PATCH (Board or List
    //    stays). Ignored for the other types, whose views are fixed. Not sent → the project starts with
    //    Automations hidden (owner, 11 Oct 2026: off by default for new projects); sent → stored as sent.
    //  - memberIds: people of THIS workspace to add as MEMBER next to the creator (LEAD). The creator
    //    and duplicates are dropped; anyone outside the workspace refuses the whole request.
    let initialHiddenTabs: string[] = template
      ? templateHiddenTabs(template)
      : typeCheck.type === "TASK" ? [...DEFAULT_HIDDEN_TABS_NEW_TASK_PROJECT] : []
    if (body.hiddenTabs !== undefined && body.hiddenTabs !== null && typeCheck.type === "TASK") {
      const tabs = normalizeHiddenTabs(body.hiddenTabs)
      if (!tabs.ok) {
        return NextResponse.json({ error: tabs.error, code: tabs.code, ...(tabs.tab !== undefined && { tab: tabs.tab }) }, { status: 400 })
      }
      initialHiddenTabs = tabs.hiddenTabs
    }
    let initialMemberIds: string[] = []
    // Level for the people added at creation (Notion-style invite dropdown, owner 13 Oct 2026); default EDIT.
    const initialMemberLevel: AccessLevel = isAccessLevel(body.memberAccessLevel) ? body.memberAccessLevel : "EDIT"
    if (body.memberIds !== undefined && body.memberIds !== null) {
      if (!Array.isArray(body.memberIds) || body.memberIds.some((x: unknown) => typeof x !== "string" || !x)) {
        return NextResponse.json({ error: "memberIds harus berupa daftar id user.", code: "INVALID_MEMBERS" }, { status: 400 })
      }
      const wanted = Array.from(new Set(body.memberIds as string[])).filter((id) => id !== userId)
      if (wanted.length > MAX_INITIAL_MEMBERS) {
        return NextResponse.json({ error: `Maksimal ${MAX_INITIAL_MEMBERS} orang sekaligus.`, code: "TOO_MANY_MEMBERS" }, { status: 400 })
      }
      if (wanted.length > 0) {
        const inWorkspace = await prisma.workspaceMember.findMany({
          where: { workspaceId, userId: { in: wanted } },
          select: { userId: true },
        })
        const ok = new Set(inWorkspace.map((m) => m.userId))
        const outside = wanted.filter((id) => !ok.has(id))
        if (outside.length > 0) {
          return NextResponse.json(
            { error: "Ada orang yang bukan anggota workspace ini.", code: "MEMBER_NOT_IN_WORKSPACE", userIds: outside },
            { status: 400 },
          )
        }
      }
      initialMemberIds = wanted
    }

    if (folderId) {
      const folder = await prisma.projectFolder.findUnique({
        where: { id: folderId },
        select: { workspaceId: true },
      })

      if (!folder || folder.workspaceId !== workspaceId) {
        return NextResponse.json({ error: "Folder must belong to the same workspace as the project" }, { status: 400 })
      }
    }

    const project = template
      ? await createProjectFromTemplate({
          template,
          lang: templateLang(body.lang),
          starter: body.starter !== false,
          name,
          description,
          color,
          icon,
          workspaceId,
          folderId: typeof folderId === "string" ? folderId : null,
          hiddenTabs: initialHiddenTabs,
          userId,
          memberIds: initialMemberIds,
          memberLevel: initialMemberLevel,
        })
      : await prisma.project.create({
      data: {
        name,
        description,
        color,
        icon,
        type: typeCheck.type,
        workspaceId,
        ...(folderId && { folderId }),
        ...(initialHiddenTabs.length > 0 && { hiddenTabs: initialHiddenTabs }),
        members: {
          create: [
            // The creator is the Project Owner (Full access); the people picked get the dialog's level.
            { userId, role: "LEAD", accessLevel: "FULL" },
            ...initialMemberIds.map((memberId) => ({ userId: memberId, role: roleForLevel(initialMemberLevel), accessLevel: initialMemberLevel })),
          ],
        },
        taskLists: {
          create: [
            // Sections are the status options (owner, 12 Oct 2026; lib/status-sections.ts).
            { name: "To Do", position: 0, taskStatus: "TODO" },
            { name: "In Progress", position: 1, taskStatus: "IN_PROGRESS" },
            { name: "Done", position: 2, taskStatus: "DONE" },
          ],
        },
        pages: {
          create: [

          ],
        },
      },
      include: {
        members: { include: { user: true } },
        taskLists: true,
        pages: true,
      },
    })

    logAudit({ action: "create", entityType: "project", entityId: project.id, entityName: name, userId, request, ...(template && { metadata: { templateId: template.id } }) })

    // The project's chat room, with its creator in it. Rooms used to appear only when someone happened
    // to open the chat list (lib/chat-membership.ts).
    await syncProjectRoomSafe(project.id, "project-created")

    // Live in every open sidebar, projects page and folder page of the workspace (a ping, no data).
    // People added in the dialog are told the same way as an add from Project settings, one each.
    emitWorkspaceChanged(workspaceId, {
      kind: "projects", projectId: project.id, folderId: typeof folderId === "string" ? folderId : undefined, actorId: userId,
    }, initialMemberIds)
    for (const member of project.members) {
      if (member.userId === userId) continue
      notifyProjectInvite({
        userId: member.userId,
        projectId: project.id,
        projectName: name,
        invitedByName: session.user.name || "Someone",
        actorId: session.user.id,
        role: member.role,
      }).catch((err) => console.error("Project invite notification error:", err))
      logAudit({ action: "create", entityType: "project_member", entityId: member.id, entityName: member.user?.name || member.userId, userId, request, metadata: { projectId: project.id, role: member.role } })
    }

    // The NAS folder pre-create used to live here. It is gone: the Files tab it existed for was
    // removed, the NAS is unreachable from every machine here, and the call
    // was fire-and-forget — so all it did was write one failure into the log every time anybody
    // created a project. A line that only ever reports the same known-dead dependency trains people
    // to skim the log, which is worse than having no line.
    //
    // Nothing waits on a project folder now. If Z Vault brings project storage back in 0.1.4, it
    // wants its own pre-create against whatever storage it actually uses, not this one revived.

    // Same best-effort deal for the default spreadsheet. The sheets GET seeds lazily anyway (that's
    // what covers projects created before this feature), so a failure here costs nothing.
    ensureProjectSheet(project.id, userId).catch((err) => {
      console.error("Failed to pre-create default sheet for project", project.id, err)
    })

    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    console.error("Error creating project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * List rows: `_count.tasks` (every task in the project's sections) plus, additive since 12 Oct 2026,
 * `completedTasks` (status DONE) and `progress` (0–100), so the Projects page shows real progress
 * instead of 0% everywhere. Released apps ignore the new keys.
 */
async function withTaskCounts<P extends { taskLists: Array<{ id: string; _count: { tasks: number } }>; _count: Record<string, number> }>(projects: P[]) {
  const listIds = projects.flatMap((p) => p.taskLists.map((tl) => tl.id))
  const done = listIds.length
    ? await prisma.task.groupBy({ by: ["taskListId"], where: { taskListId: { in: listIds }, status: "DONE" }, _count: { _all: true } })
    : []
  const doneBy = new Map(done.map((d) => [d.taskListId, d._count._all]))
  return projects.map((project) => {
    const taskCount = project.taskLists.reduce((sum, tl) => sum + tl._count.tasks, 0)
    const completedTasks = project.taskLists.reduce((sum, tl) => sum + (doneBy.get(tl.id) ?? 0), 0)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { taskLists: _lists, ...rest } = project
    return {
      ...rest,
      _count: { ...project._count, tasks: taskCount },
      totalTasks: taskCount,
      completedTasks,
      progress: taskCount ? Math.round((completedTasks / taskCount) * 100) : 0,
    }
  })
}
