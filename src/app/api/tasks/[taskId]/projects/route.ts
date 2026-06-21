export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess, checkWorkspaceRoutingAccess } from "@/lib/rbac"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"
import { resolveAutoAssignAssigneeIds } from "@/lib/project-auto-assign"

const DEFAULT_TASK_LIST_ALIASES = ["to do", "todo", "backlog"]

function getDefaultTaskList(taskLists: Array<{ id: string; name: string; position: number }>) {
  if (taskLists.length === 0) return null

  const normalized = taskLists
    .slice()
    .sort((a, b) => a.position - b.position)

  return (
    normalized.find((taskList) =>
      DEFAULT_TASK_LIST_ALIASES.includes(taskList.name.toLowerCase().trim())
    ) ?? normalized[0]
  )
}

async function loadTaskContext(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      taskList: {
        include: {
          project: {
            select: {
              id: true,
              name: true,
              color: true,
              icon: true,
              workspaceId: true,
            },
          },
        },
      },
      taskProjects: {
        include: {
          project: {
            select: {
              id: true,
              name: true,
              color: true,
              icon: true,
            },
          },
          taskList: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })
}

async function ensureTaskAccess(userId: string, taskId: string) {
  const task = await loadTaskContext(taskId)
  if (!task) return { task: null, allowed: false }

  const projectIds = [
    task.taskList.projectId,
    ...task.taskProjects.map((taskProject) => taskProject.projectId),
  ]

  for (const projectId of Array.from(new Set(projectIds))) {
    const { allowed } = await checkProjectAccess(userId, projectId, ["MEMBER"])
    if (allowed) return { task, allowed: true }
  }

  return { task, allowed: false }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { task, allowed } = await ensureTaskAccess(session.user.id, taskId)
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { allowed: canRouteWithinWorkspace } = await checkWorkspaceRoutingAccess(
      session.user.id,
      task.taskList.project.workspaceId
    )
    if (!canRouteWithinWorkspace) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const excludedProjectIds = [
      task.taskList.projectId,
      ...task.taskProjects.map((taskProject) => taskProject.projectId),
    ]

    const availableProjects = await prisma.project.findMany({
      where: {
        workspaceId: task.taskList.project.workspaceId,
        id: { notIn: excludedProjectIds },
      },
      select: {
        id: true,
        name: true,
        color: true,
        icon: true,
        taskLists: {
          select: {
            id: true,
            name: true,
            position: true,
          },
          orderBy: { position: "asc" },
        },
      },
      orderBy: { name: "asc" },
    })

    return NextResponse.json({
      primaryProject: {
        projectId: task.taskList.projectId,
        project: {
          id: task.taskList.project.id,
          name: task.taskList.project.name,
          color: task.taskList.project.color,
          icon: task.taskList.project.icon,
        },
        taskListId: task.taskListId,
        taskListName: task.taskList.name,
      },
      additionalProjects: task.taskProjects.map((taskProject) => ({
        id: taskProject.id,
        projectId: taskProject.projectId,
        project: taskProject.project,
        taskListId: taskProject.taskListId,
        taskListName: taskProject.taskList.name,
      })),
      availableProjects: availableProjects.flatMap((project) => {
        const defaultTaskList = getDefaultTaskList(project.taskLists)
        if (!defaultTaskList) return []

        return [{
          id: project.id,
          name: project.name,
          color: project.color,
          icon: project.icon,
          defaultTaskListId: defaultTaskList.id,
          defaultTaskListName: defaultTaskList.name,
        }]
      }),
    })
  } catch (error) {
    console.error("Error fetching task projects:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { projectId, taskListId } = body

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    }

    const { task, allowed } = await ensureTaskAccess(session.user.id, taskId)
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    if (projectId === task.taskList.projectId) {
      return NextResponse.json({ error: "Task is already in this project" }, { status: 409 })
    }

    const existing = await prisma.taskProject.findUnique({
      where: { taskId_projectId: { taskId: taskId, projectId } },
    })
    if (existing) {
      return NextResponse.json({ error: "Task is already in this project" }, { status: 409 })
    }

    const targetProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        workspaceId: true,
        autoAssignEnabled: true,
        autoAssignAssigneeIds: true,
        members: {
          select: {
            userId: true,
          },
        },
        taskLists: {
          select: {
            id: true,
            name: true,
            position: true,
          },
          orderBy: { position: "asc" },
        },
      },
    })

    if (!targetProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const { allowed: canRouteWithinWorkspace } = await checkWorkspaceRoutingAccess(
      session.user.id,
      task.taskList.project.workspaceId
    )
    if (!canRouteWithinWorkspace) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (targetProject.workspaceId !== task.taskList.project.workspaceId) {
      return NextResponse.json({ error: "Task can only be linked within the same workspace" }, { status: 400 })
    }

    const resolvedTaskList = taskListId
      ? targetProject.taskLists.find((taskList) => taskList.id === taskListId)
      : getDefaultTaskList(targetProject.taskLists)

    if (!resolvedTaskList) {
      return NextResponse.json({ error: "Target project has no task lists available" }, { status: 400 })
    }

    const taskProject = await prisma.taskProject.create({
      data: {
        taskId: taskId,
        projectId,
        taskListId: resolvedTaskList.id,
        position: task.position,
      },
      include: {
        project: { select: { id: true, name: true, color: true, icon: true } },
        taskList: { select: { id: true, name: true } },
      },
    })

    await seedTaskCustomFieldValues(taskId, projectId, task.createdAt)

    const autoAssignAssigneeIds = resolveAutoAssignAssigneeIds({
      requestedAssigneeIds: [],
      autoAssignEnabled: targetProject.autoAssignEnabled,
      autoAssignAssigneeIds: targetProject.autoAssignAssigneeIds,
      validProjectMemberIds: targetProject.members.map((member) => member.userId),
    })

    if (autoAssignAssigneeIds.length > 0) {
      await prisma.taskAssignee.createMany({
        data: autoAssignAssigneeIds.map((userId) => ({
          taskId: taskId,
          userId,
        })),
        skipDuplicates: true,
      })
    }

    const taskAssignees = await prisma.taskAssignee.findMany({
      where: { taskId: taskId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    })

    return NextResponse.json(
      {
        taskProject,
        taskAssignees,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Error adding task to project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { projectId } = body

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    }

    const { task, allowed } = await ensureTaskAccess(session.user.id, taskId)
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    if (projectId === task.taskList.projectId) {
      return NextResponse.json({ error: "Primary project cannot be removed" }, { status: 400 })
    }

    const targetProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    })

    if (!targetProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const { allowed: canRouteWithinWorkspace } = await checkWorkspaceRoutingAccess(
      session.user.id,
      task.taskList.project.workspaceId
    )
    if (!canRouteWithinWorkspace || targetProject.workspaceId !== task.taskList.project.workspaceId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const taskProject = await prisma.taskProject.findUnique({
      where: { taskId_projectId: { taskId: taskId, projectId } },
    })

    if (!taskProject) {
      return NextResponse.json({ error: "Task is not in this project" }, { status: 404 })
    }

    await prisma.taskProject.delete({
      where: { taskId_projectId: { taskId: taskId, projectId } },
    })

    return NextResponse.json({ message: "Task removed from project" })
  } catch (error) {
    console.error("Error removing task from project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
