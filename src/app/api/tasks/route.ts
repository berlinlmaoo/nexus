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
import { notifyTaskAssigned } from "@/lib/notification-service"

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
        .filter((membership) => membership.role === "BOD" || membership.role === "MANAGER" || membership.role === "ONE_ABOVE_ALL")
        .map((membership) => membership.workspaceId)

      const memberWorkspaceIds = workspaceMemberships
        .filter((membership) => membership.role === "STAFF")
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
    } else {
      // Folder aggregate view: ?projectIds=a,b,c → tasks across that set of projects (access scopes above
      // still apply, so a user only ever sees tasks in projects they can access).
      const projectIds = (searchParams.get("projectIds") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
      if (projectIds.length) {
        where.taskList = {
          ...(where.taskList as Prisma.TaskListWhereInput | undefined),
          projectId: { in: projectIds },
        }
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

    // Attach task-bundle quest membership (board/list "+X XP" badge) — mirrors the project payload so
    // that subtask cards (which the board/list pull from here, not the parentId-only project payload)
    // also show the chip. Scoped to the returned, already-access-controlled task ids.
    const taskIds = tasks.map((t) => t.id)
    if (taskIds.length) {
      const quests = await prisma.quest.findMany({
        where: { isActive: true, requirementType: "specific_tasks", taskIds: { hasSome: taskIds } },
        select: { id: true, title: true, xpReward: true, taskIds: true },
      })
      if (quests.length) {
        const byTask = new Map<string, { id: string; title: string; xpReward: number }[]>()
        for (const q of quests) for (const tid of q.taskIds) { const a = byTask.get(tid) ?? []; a.push({ id: q.id, title: q.title, xpReward: q.xpReward }); byTask.set(tid, a) }
        for (const t of tasks) (t as { quests?: unknown }).quests = byTask.get(t.id) ?? []
      }
    }

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
            name: true,
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

    // Subtask parent must be a task in the SAME project (an unvalidated parentId could attach a
    // subtask onto any workspace's task — content injection into a panel you can't even open).
    // Depth is capped Asana-style: max 5 levels of nesting.
    if (parentId) {
      const parent = await prisma.task.findUnique({
        where: { id: parentId },
        select: { id: true, parentId: true, taskList: { select: { projectId: true } } },
      })
      if (!parent || parent.taskList.projectId !== taskList.projectId) {
        return NextResponse.json({ error: "Parent task not found in this project" }, { status: 400 })
      }
      let depth = 1
      let cursor = parent.parentId
      while (cursor && depth < 5) {
        const up: { parentId: string | null } | null = await prisma.task.findUnique({ where: { id: cursor }, select: { parentId: true } })
        cursor = up?.parentId ?? null
        depth++
      }
      if (depth >= 5) {
        return NextResponse.json({ error: "Maximum subtask depth (5) reached" }, { status: 400 })
      }
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

    await Promise.all(finalAssigneeIds.map((assigneeId) =>
      notifyTaskAssigned({
        assigneeId,
        taskId: task.id,
        taskTitle: task.title,
        projectName: taskList.project.name,
        projectId: taskList.projectId,
        assignedByName: session.user.name || "Someone",
      })
    ))

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
