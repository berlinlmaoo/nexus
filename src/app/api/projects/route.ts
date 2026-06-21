export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { isSystemAdminUser } from "@/lib/rbac"
import { ensureProjectFolder } from "@/lib/nas-project"

const projectListSelect = {
  id: true,
  name: true,
  description: true,
  color: true,
  icon: true,
  status: true,
  workspaceId: true,
  folderId: true,
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

    const where: Record<string, unknown> = isSystemAdmin
      ? {}
      : whereScopes.length === 1
        ? whereScopes[0]
        : { OR: whereScopes }

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

    const userId = session.user.id

    // Verify the user is a member of the target workspace
    const workspaceMembership = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    })
    if (!workspaceMembership) {
      return NextResponse.json({ error: "Forbidden: you are not a member of this workspace" }, { status: 403 })
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

    // Best-effort: pre-create the project's NAS storage folder so it exists immediately.
    // Never blocks project creation — lazy creation in the files route still covers any failure.
    ensureProjectFolder(project.id).catch((err) => {
      console.error("Failed to pre-create NAS folder for project", project.id, err)
    })

    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    console.error("Error creating project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
