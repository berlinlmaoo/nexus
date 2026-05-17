export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { logAudit } from "@/lib/audit"

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed } = await checkProjectAccess(session.user.id, params.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    const original = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        taskLists: {
          include: {
            tasks: {
              include: {
                assignees: { select: { userId: true } },
              },
            },
          },
          orderBy: { position: "asc" },
        },
        members: { select: { userId: true, role: true } },
      },
    })

    if (!original) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    // Create the duplicated project
    const newProject = await prisma.project.create({
      data: {
        name: `Copy of ${original.name}`,
        description: original.description,
        color: original.color,
        icon: original.icon,
        status: original.status,
        workspaceId: original.workspaceId,
        members: {
          create: { userId: session.user.id, role: "LEAD" },
        },
      },
    })

    // Duplicate task lists and tasks
    for (const taskList of original.taskLists) {
      const newTaskList = await prisma.taskList.create({
        data: {
          name: taskList.name,
          position: taskList.position,
          projectId: newProject.id,
        },
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
            creatorId: session.user.id,
          },
        })

        // Copy assignees
        if (task.assignees.length > 0) {
          await prisma.taskAssignee.createMany({
            data: task.assignees.map((a) => ({
              taskId: newTask.id,
              userId: a.userId,
            })),
          })
        }
      }
    }

    logAudit({
      action: "create",
      entityType: "project",
      entityId: newProject.id,
      entityName: newProject.name,
      userId: session.user.id,
      request,
      metadata: { duplicatedFrom: params.projectId },
    })

    // Return full project
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
