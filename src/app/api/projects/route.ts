export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess, isSystemAdminUser } from "@/lib/rbac"
import { ensureProjectSheet } from "@/lib/project-sheets"
import { syncProjectRoomSafe } from "@/lib/chat-membership"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { checkCreatableProjectType } from "@/lib/project-tabs"
import { companyPipelineProject } from "@/lib/pipeline-access"
import { ORG_WORKSPACE_ID } from "@/lib/org"

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

        const result = projects.map((project) => {
          const taskCount = project.taskLists.reduce(
            (sum, tl) => sum + tl._count.tasks,
            0
          )
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { taskLists: _lists, ...rest } = project
          return {
            ...rest,
            _count: {
              ...project._count,
              tasks: taskCount,
            },
          }
        })

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
        workspaceMembership.role === "BOD" ||
        workspaceMembership.role === "MANAGER" || workspaceMembership.role === "ONE_ABOVE_ALL" ||
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

      const result = projects.map((project) => {
        const taskCount = project.taskLists.reduce(
          (sum, tl) => sum + tl._count.tasks,
          0
        )
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { taskLists: _lists, ...rest } = project
        return {
          ...rest,
          _count: {
            ...project._count,
            tasks: taskCount,
          },
        }
      })

      return NextResponse.json(result)
    }

    const workspaceMemberships = await prisma.workspaceMember.findMany({
      where: { userId: session.user.id },
      select: { workspaceId: true, role: true },
    })

    const adminWorkspaceIds = workspaceMemberships
      .filter((membership) => membership.role === "BOD" || membership.role === "MANAGER" || membership.role === "ONE_ABOVE_ALL")
      .map((membership) => membership.workspaceId)

    const memberWorkspaceIds = workspaceMemberships
      .filter((membership) => membership.role === "STAFF")
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

    const result = projects.map((project) => {
      const taskCount = project.taskLists.reduce(
        (sum, tl) => sum + tl._count.tasks,
        0
      )
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { taskLists: _lists, ...rest } = project
      return {
        ...rest,
        _count: {
          ...project._count,
          tasks: taskCount,
        },
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json([])
    }

    console.error("Error fetching projects:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

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
    // this sends. Finance Dashboard, Content Planner and Pipeline Dashboard are "coming soon".
    const typeCheck = checkCreatableProjectType(body.type)
    if (!typeCheck.ok) {
      return NextResponse.json({ error: typeCheck.error, code: typeCheck.code }, { status: 400 })
    }

    const userId = session.user.id

    // Verify the user is a member of the target workspace
    const workspaceMembership = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    })
    if (!workspaceMembership) {
      return NextResponse.json({ error: "Forbidden: you are not a member of this workspace" }, { status: 403 })
    }

    // One Pipeline board for the whole company (owner/GM, 9 Oct 2026: "Desainnya cuma satu papan/pipeline
    // utama buat semua deal, lintas BD dan brand — bukan pipeline terpisah per project"). It lives in the
    // company workspace and a second one is refused. Making the first one is open to the company like any
    // project (its maker is its lead and adds the people, owner 9 Oct 2026 evening); the refusal names the
    // board only to someone who can open it — the New project dialog then opens it — and tells anyone
    // else to ask its lead to add them.
    if (typeCheck.type === "PIPELINE") {
      if (workspaceId !== ORG_WORKSPACE_ID) {
        return NextResponse.json(
          { error: "Pipeline Dashboard hanya ada di workspace perusahaan.", code: "PIPELINE_COMPANY_ONLY" },
          { status: 400 },
        )
      }
      const existing = await companyPipelineProject()
      if (existing && !(await checkProjectAccess(userId, existing.id, ["VIEWER"])).allowed) {
        return NextResponse.json(
          { error: "Pipeline perusahaan sudah ada. Minta lead-nya menambahkan kamu ke project itu.", code: "PIPELINE_EXISTS" },
          { status: 409 },
        )
      }
      if (existing) {
        return NextResponse.json(
          { error: `Pipeline perusahaan sudah ada: "${existing.name}".`, code: "PIPELINE_EXISTS", projectId: existing.id, projectName: existing.name },
          { status: 409 },
        )
      }
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

    const project = await prisma.project.create({
      data: {
        name,
        description,
        color,
        icon,
        type: typeCheck.type,
        workspaceId,
        ...(folderId && { folderId }),
        members: {
          create: {
            userId,
            role: "LEAD",
          },
        },
        taskLists: {
          create: [
            { name: "To Do", position: 0 },
            { name: "In Progress", position: 1 },
            { name: "Done", position: 2 },
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

    logAudit({ action: "create", entityType: "project", entityId: project.id, entityName: name, userId, request })

    // The project's chat room, with its creator in it. Rooms used to appear only when someone happened
    // to open the chat list (lib/chat-membership.ts).
    await syncProjectRoomSafe(project.id, "project-created")

    // Live in every open sidebar, projects page and folder page of the workspace (a ping, no data).
    emitWorkspaceChanged(workspaceId, {
      kind: "projects", projectId: project.id, folderId: typeof folderId === "string" ? folderId : undefined, actorId: userId,
    })

    // The NAS folder pre-create used to live here. It is gone: the Files tab it existed for was
    // removed, the Synology at 192.168.223.92 is unreachable from every machine here, and the call
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
