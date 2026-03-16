import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { executeAutomations } from "@/lib/automation-engine"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import { emitTaskCreated } from "@/lib/socket-emitter"
import type { Prisma } from "@/generated/prisma/client"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const searchParams = request.nextUrl.searchParams
    const projectId = searchParams.get("projectId")
    const taskListId = searchParams.get("taskListId")
    const status = searchParams.get("status")
    const priority = searchParams.get("priority")
    const assigneeId = searchParams.get("assigneeId")
    const search = searchParams.get("search")

    const where: Prisma.TaskWhereInput = {
      // Workspace isolation: only return tasks from projects the user is a member of
      taskList: {
        project: {
          members: {
            some: { userId: session.user.id },
          },
        },
      },
    }

    if (projectId) {
      where.taskList = { ...where.taskList as Prisma.TaskListWhereInput, projectId }
    }
    if (taskListId) {
      where.taskListId = taskListId
    }
    if (status) {
      where.status = status as Prisma.EnumTaskStatusFilter["equals"]
    }
    if (priority) {
      where.priority = priority as Prisma.EnumTaskPriorityFilter["equals"]
    }
    if (assigneeId) {
      where.assignees = { some: { userId: assigneeId } }
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ]
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignees: { include: { user: true } },
        creator: true,
        taskList: true,
        _count: {
          select: {
            subtasks: true,
            comments: true,
          },
        },
      },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    })

    return NextResponse.json(tasks)
  } catch (error) {
    console.error("Error fetching tasks:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { title, description, status, priority, taskListId, dueDate, tags, assigneeIds, parentId } = body

    if (!title || !taskListId) {
      return NextResponse.json({ error: "Title and taskListId are required" }, { status: 400 })
    }

    const taskList = await prisma.taskList.findUnique({
      where: { id: taskListId },
      include: { project: true },
    })

    if (!taskList) {
      return NextResponse.json({ error: "TaskList not found" }, { status: 404 })
    }

    const { allowed } = await checkProjectAccess(session.user.id, taskList.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required to create tasks" }, { status: 403 })
    }

    const userId = session.user.id

    const task = await prisma.task.create({
      data: {
        title,
        description,
        status: status || undefined,
        priority: priority || undefined,
        taskListId,
        creatorId: userId,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        tags: tags || [],
        parentId,
        assignees: assigneeIds?.length
          ? {
              create: assigneeIds.map((uid: string) => ({ userId: uid })),
            }
          : undefined,
      },
      include: {
        assignees: { include: { user: true } },
        creator: true,
        taskList: true,
        _count: {
          select: { subtasks: true, comments: true },
        },
      },
    })

    await prisma.activityLog.create({
      data: {
        action: "created task",
        details: `Created task "${title}"`,
        userId,
        taskId: task.id,
        projectId: taskList.projectId,
      },
    })

    logAudit({ action: "create", entityType: "task", entityId: task.id, entityName: title, userId, request })

    // Fire automations and webhook (non-blocking)
    executeAutomations(taskList.projectId, "task_created", {
      taskId: task.id,
      userId,
      projectId: taskList.projectId,
      assigneeIds: assigneeIds || [],
    }).catch(() => {})

    dispatchWebhookEvent("task.created", {
      taskId: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      taskListId: task.taskListId,
      creatorId: userId,
    }, taskList.projectId).catch(() => {})

    // Real-time: broadcast to project room
    emitTaskCreated(taskList.projectId, JSON.parse(JSON.stringify(task)))

    return NextResponse.json(task, { status: 201 })
  } catch (error) {
    console.error("Error creating task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
