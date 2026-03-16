import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const taskProjects = await prisma.taskProject.findMany({
      where: { taskId: params.taskId },
      include: {
        project: { select: { id: true, name: true, color: true, icon: true } },
        taskList: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    })

    // Also include the primary project (from task.taskList)
    const task = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: {
        taskList: {
          include: { project: { select: { id: true, name: true, color: true, icon: true } } },
        },
      },
    })

    return NextResponse.json({
      primaryProject: task ? {
        projectId: task.taskList.projectId,
        project: task.taskList.project,
        taskListId: task.taskListId,
        taskListName: task.taskList.name,
      } : null,
      additionalProjects: taskProjects.map((tp) => ({
        id: tp.id,
        projectId: tp.projectId,
        project: tp.project,
        taskListId: tp.taskListId,
        taskListName: tp.taskList.name,
      })),
    })
  } catch (error) {
    console.error("Error fetching task projects:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { projectId, taskListId } = body

    if (!projectId || !taskListId) {
      return NextResponse.json({ error: "projectId and taskListId are required" }, { status: 400 })
    }

    // Verify task exists
    const task = await prisma.task.findUnique({ where: { id: params.taskId } })
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

    // Check user has access to the target project
    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    // Verify taskList belongs to project
    const taskList = await prisma.taskList.findFirst({
      where: { id: taskListId, projectId },
    })
    if (!taskList) {
      return NextResponse.json({ error: "TaskList not found in the specified project" }, { status: 404 })
    }

    // Check not already added
    const existing = await prisma.taskProject.findUnique({
      where: { taskId_projectId: { taskId: params.taskId, projectId } },
    })
    if (existing) {
      return NextResponse.json({ error: "Task is already in this project" }, { status: 409 })
    }

    const taskProject = await prisma.taskProject.create({
      data: {
        taskId: params.taskId,
        projectId,
        taskListId,
      },
      include: {
        project: { select: { id: true, name: true, color: true, icon: true } },
        taskList: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(taskProject, { status: 201 })
  } catch (error) {
    console.error("Error adding task to project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { projectId } = body

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    }

    const taskProject = await prisma.taskProject.findUnique({
      where: { taskId_projectId: { taskId: params.taskId, projectId } },
    })

    if (!taskProject) {
      return NextResponse.json({ error: "Task is not in this project" }, { status: 404 })
    }

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    await prisma.taskProject.delete({
      where: { taskId_projectId: { taskId: params.taskId, projectId } },
    })

    return NextResponse.json({ message: "Task removed from project" })
  } catch (error) {
    console.error("Error removing task from project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
