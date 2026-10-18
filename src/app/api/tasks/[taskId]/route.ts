export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { TASK_ORDER } from "@/lib/task-order"
import { auth } from "@/lib/auth"
import { canReadTask, taskReadRefusal } from "@/lib/read-access"
import { deleteTaskAs, TaskDeleteRefusal } from "@/lib/task-delete"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { applyTaskUpdate } from "@/lib/task-update"
import { needsLegacyCalendarTaskRead } from "@/lib/client-version"
import { buildCalendarItems, calendarCaller, loadStructure, loadTaskRowById } from "@/lib/calendar/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Signed in is not enough (API.md E5) — see lib/read-access.ts for who may open a task.
    const readable = await canReadTask(session.user.id!, taskId)
    // Compatibility (owner 13 Oct 2026): released iOS (< 0.1.7, incl. header-less builds) and Android
    // (< 0.1.7) open a Master Calendar task with THIS route. The calendar shows every non-private project's
    // tasks to everyone, so for those apps a non-member still gets a read-only copy of such a task — the
    // same thing /api/calendar/task?detail=1 gives newer apps. Never a private project's task, never a
    // write, and the copy carries no file URLs, no activity and only public user fields.
    let legacyReadOnly = false
    if (readable === "forbidden" && needsLegacyCalendarTaskRead(request.headers.get("x-nexus-client"), request.headers.get("user-agent"))) {
      legacyReadOnly = await calendarShowsTask(taskId)
    }
    if (readable !== "ok" && !legacyReadOnly) return taskReadRefusal(readable)

    const [task, likeCount, userLike, taskProjects, questRows] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        include: {
          assignees: { include: { user: true } },
          comments: {
            include: { user: true },
            orderBy: { createdAt: "asc" },
          },
          // Breadcrumb context: a subtask's panel shows (and navigates back to) its parent.
          parent: { select: { id: true, title: true } },
          subtasks: {
            include: {
              assignees: { include: { user: { select: { id: true, name: true, avatar: true } } } },
            },
            orderBy: TASK_ORDER,
          },
          activityLogs: {
            include: { user: true },
            orderBy: { createdAt: "desc" },
          },
          taskList: { include: { project: { select: { id: true, name: true, color: true, icon: true } } } },
          creator: true,
        },
      }),
      prisma.taskLike.count({ where: { taskId: taskId } }),
      prisma.taskLike.findUnique({
        where: { taskId_userId: { taskId: taskId, userId: session.user.id! } },
      }),
      prisma.taskProject.findMany({
        where: { taskId: taskId },
        include: {
          project: { select: { id: true, name: true, color: true, icon: true } },
          taskList: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      // Active task-bundle quests that include this task (for the "+X XP" nudge on the task panel).
      prisma.quest.findMany({
        where: { isActive: true, requirementType: "specific_tasks", taskIds: { has: taskId } },
        select: { id: true, title: true, xpReward: true, taskIds: true },
      }),
    ])

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const quests = await Promise.all(
      questRows.map(async (q) => ({
        id: q.id,
        title: q.title,
        xpReward: q.xpReward,
        total: q.taskIds.length,
        done: await prisma.task.count({ where: { id: { in: q.taskIds }, status: "DONE" } }),
      }))
    )

    if (legacyReadOnly) {
      const pub = (u: { id: string; name: string | null; email: string; avatar: string | null } | null) => (u ? { id: u.id, name: u.name, email: u.email, avatar: u.avatar } : null)
      return NextResponse.json({
        ...task,
        assignees: task.assignees.map((a) => ({ ...a, user: pub(a.user) })),
        comments: task.comments.map((c) => ({ ...c, user: pub(c.user) })),
        creator: pub(task.creator),
        activityLogs: [],
        likeCount,
        liked: !!userLike,
        taskProjects,
        quests: [],
        readOnly: true,
      })
    }

    return NextResponse.json({
      ...task,
      likeCount,
      liked: !!userLike,
      taskProjects,
      quests,
    })
  } catch (error) {
    console.error("Error fetching task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed: rlAllowed, resetAt } = checkRateLimit(request, session.user.id!, { limit: 60, windowSeconds: 60 })
    if (!rlAllowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    // The rules of a task edit live in lib/task-update.ts, shared with POST /api/tasks/batch-move.
    return await applyTaskUpdate({ request, session, taskId, body })
  } catch (error) {
    console.error("Error updating task:", error)
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
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // One path with GIDEON's delete_task (lib/task-delete.ts): Can edit deletes (Notion levels, owner 13 Oct 2026),
    // the delete is restorable from the Audit, and every project showing the task hears about it.
    let auditLogId: string | null
    try {
      ({ auditLogId } = await deleteTaskAs(session.user.id!, taskId, { request }))
    } catch (error) {
      if (error instanceof TaskDeleteRefusal) {
        return NextResponse.json({ error: error.message, ...(error.code === "NOT_FOUND" ? {} : { code: error.code }) }, { status: error.status })
      }
      throw error
    }

    // auditLogId (additive, 12 Oct 2026): the web's Undo puts the task back through /api/tasks/undo-delete.
    return NextResponse.json({ message: "Task deleted", auditLogId })
  } catch (error) {
    console.error("Error deleting task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}


/** Does the Master Calendar show this task to the caller, unmasked (lib/calendar: visible + not a private project)? */
async function calendarShowsTask(taskId: string): Promise<boolean> {
  try {
    const caller = await calendarCaller()
    if (caller instanceof NextResponse || caller.kind !== "ok") return false
    const [row, s] = await Promise.all([loadTaskRowById(taskId), loadStructure()])
    if (!row) return false
    const item = (await buildCalendarItems([row], caller, s))[0]
    return !!item && !item.masked
  } catch {
    return false
  }
}
