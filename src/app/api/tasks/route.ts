export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { TASK_ORDER } from "@/lib/task-order"
import { USER_CARD_SELECT } from "@/lib/user-card-select"
import { auth } from "@/lib/auth"
import type { Prisma } from "@/generated/prisma/client"
import { TaskPriority, TaskStatus } from "@/generated/prisma"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { hasProjectWideAccess } from "@/lib/rbac"
import { applyTaskCreate } from "@/lib/task-create"

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

    const where: Prisma.TaskWhereInput = {}
    const andClauses: Prisma.TaskWhereInput[] = []

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

    // Your own tasks wherever they are (assigned to you): a Manager who isn't a member of a project any more
    // (owner 13 Oct 2026, membership-only access) still sees the tasks they were given, as search does.
    accessScopes.push({ assignees: { some: { userId: session.user.id } } })

    if (accessScopes.length === 0) {
      return NextResponse.json([])
    }

    if (accessScopes.length === 1) {
      Object.assign(where, accessScopes[0])
    } else {
      andClauses.push({ OR: accessScopes })
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
    // `?subtasksOnly=1` (web board/list, perf pass 12 Oct 2026): only tasks that have a parent. The project
    // payload already carries the top-level tasks, so the board needs just these to show subtask cards.
    // Servers without it return every task, which the web handles the same way.
    if (searchParams.get("subtasksOnly") === "1") {
      where.parentId = { not: null }
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
        assignees: { include: { user: { select: USER_CARD_SELECT } } },
        creator: { select: USER_CARD_SELECT },
        taskList: true,
        _count: {
          select: {
            subtasks: true,
            comments: true,
          },
        },
      },
      orderBy: TASK_ORDER,
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

    // 120/min per user (was 30): a person chaining inline "Enter" cards, pasting a list or working in two tabs
    // hit 30 (bughunt N-BUG-9). Still a ceiling for a runaway client or script.
    const { allowed: rlAllowed, resetAt } = checkRateLimit(request, session.user.id, { limit: 120, windowSeconds: 60 })
    if (!rlAllowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    return await applyTaskCreate({ request, session: { user: { id: session.user.id, name: session.user.name } }, body })
  } catch (error) {
    console.error("Error creating task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
