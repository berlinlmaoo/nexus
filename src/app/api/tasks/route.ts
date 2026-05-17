export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess, isSystemAdminUser } from "@/lib/rbac"
import { executeAutomations } from "@/lib/automation-engine"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import { emitTaskCreated } from "@/lib/socket-emitter"
import type { Prisma } from "@/generated/prisma/client"
import { TaskPriority, TaskStatus } from "@/generated/prisma"
import { createTaskSchema, validateBody } from "@/lib/validations"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"
import { resolveAutoAssignAssigneeIds } from "@/lib/project-auto-assign"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)

    const searchParams = request.nextUrl.searchParams
    const projectId = searchParams.get("projectId")
    const taskListId = searchParams.get("taskListId")
    const status = searchParams.get("status")
    const priority = searchParams.get("priority")
    const assigneeId = searchParams.get("assigneeId")
    const search = searchParams.get("search")

    const where: Prisma.TaskWhereInput = {}
    const andClauses: Prisma.TaskWhereInput[] = []

    if (!isSystemAdmin) {
      const workspaceMemberships = await prisma.workspaceMember.findMany({
        where: { userId: session.user.id },
        select: { workspaceId: true, role: true },
      })

      const adminWorkspaceIds = workspaceMemberships
        .filter((membership) => membership.role === "OWNER" || membership.role === "ADMIN")
        .map((membership) => membership.workspaceId)

      const memberWorkspaceIds = workspaceMemberships
        .filter((membership) => membership.role === "MEMBER")
        .map((membership) => membership.workspaceId)

      const accessScopes: Prisma.TaskWhereInput[] = []

      if (adminWorkspaceIds.length > 0) {
        accessScopes.push({
          taskList: {
            project: {
              workspaceId: { in: adminWorkspaceIds },
            },
          },
        })
      }

      if (memberWorkspaceIds.length > 0) {
        accessScopes.push({
          taskList: {
            project: {
              workspaceId: { in: memberWorkspaceIds },
              members: {
                some: { userId: session.user.id },
              },
            },
          },
        })
      }

      if (accessScopes.length === 0) {
        return NextResponse.json([])
      }

      if (accessScopes.length === 1) {
        Object.assign(where, accessScopes[0])
      } else {
        andClauses.push({ OR: accessScopes })
      }
    }

    if (projectId) {
      where.taskList = {
        ...(where.taskList as Prisma.TaskListWhereInput | undefined),
        projectId,
      }
    }
    if (taskListId) {
      where.taskListId = taskListId
    }
    if (status) {
      const statuses = status
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean) as TaskStatus[]

      if (statuses.length === 1) {
        where.status = statuses[0]
      } else if (statuses.length > 1) {
        where.status = { in: statuses }
      }
    }
    if (priority) {
      const priorities = priority
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean) as TaskPriority[]

      if (priorities.length === 1) {
        where.priority = priorities[0]
      } else if (priorities.length > 1) {
        where.priority = { in: priorities }
      }
    }
    if (assigneeId) {
      where.assignees = { some: { userId: assigneeId } }
    }
    if (search) {
      andClauses.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      })
    }

    if (andClauses.length > 0) {
      where.AND = andClauses
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

    const { allowed: rlAllowed, resetAt } = checkRateLimit(request, session.user.id, { limit: 30, windowSeconds: 60 })
    if (!rlAllowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    const validation = validateBody(createTaskSchema, body)
    if (!validation.success) return validation.error

    const { title, description, status, priority, taskListId, dueDate, tags, assigneeIds, parentId } = validation.data

    const taskList = await prisma.taskList.findUnique({
      where: { id: taskListId },
      include: {
        project: {
          select: {
            id: true,
            autoAssignEnabled: true,
            autoAssignAssigneeIds: true,
            members: {
              select: {
                userId: true,
              },
            },
          },
        },
      },
    })

    if (!taskList) {
      return NextResponse.json({ error: "TaskList not found" }, { status: 404 })
    }

    const { allowed } = await checkProjectAccess(session.user.id, taskList.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required to create tasks" }, { status: 403 })
    }

    const finalAssigneeIds = resolveAutoAssignAssigneeIds({
      requestedAssigneeIds: assigneeIds,
      autoAssignEnabled: taskList.project.autoAssignEnabled,
      autoAssignAssigneeIds: taskList.project.autoAssignAssigneeIds,
      validProjectMemberIds: taskList.project.members.map((member) => member.userId),
    })

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
        assignees: finalAssigneeIds.length
          ? {
              create: finalAssigneeIds.map((uid: string) => ({ userId: uid })),
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

    await seedTaskCustomFieldValues(task.id, taskList.projectId, task.createdAt)

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
      assigneeIds: finalAssigneeIds,
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
