export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { canReadTask, taskReadRefusal } from "@/lib/read-access"
import { logAudit } from "@/lib/audit"
import { deleteKeepingSnapshot } from "@/lib/deletion-snapshot"
import { checkProjectAccess } from "@/lib/rbac"
import { emitTaskDeleted } from "@/lib/socket-emitter"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { applyTaskUpdate } from "@/lib/task-update"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Signed in is not enough (API.md E5) — see lib/read-access.ts for who may open a task.
    const readable = await canReadTask(session.user.id!, taskId)
    if (readable !== "ok") return taskReadRefusal(readable)

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
            orderBy: { position: "asc" },
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

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        taskList: { include: { project: { select: { name: true, workspaceId: true } } } },
        taskProjects: {
          select: { projectId: true },
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Can edit deletes tasks (Notion levels, owner 13 Oct 2026); the delete is restorable from the Audit.
    const { allowed } = await checkProjectAccess(session.user.id!, existing.taskList.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: you need Can edit access in this project to delete tasks", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
    }

    await prisma.activityLog.create({
      data: {
        action: "deleted task",
        details: `Deleted task "${existing.title}"`,
        userId: session.user.id!,
        projectId: existing.taskList.projectId,
      },
    })

    const auditLogId = await logAudit({
      action: "delete", entityType: "task", entityId: taskId, entityName: existing.title,
      userId: session.user.id!, request,
      // The task is gone after this; keep enough to say what it was and where it lived.
      metadata: {
        title: existing.title,
        projectId: existing.taskList.projectId,
        projectName: existing.taskList.project?.name ?? null,
      },
    })

    // Everything the delete takes with it (subtasks, files, comments…) is kept first, so Control Room →
    // Audit can restore it.
    await deleteKeepingSnapshot({
      entityType: "task", entityId: taskId, entityName: existing.title,
      workspaceId: existing.taskList.project?.workspaceId ?? null,
      deletedById: session.user.id!, auditLogId,
      meta: {
        open: { type: "task", id: taskId, projectId: existing.taskList.projectId },
        projectId: existing.taskList.projectId, taskId,
      },
      remove: (tx) => tx.task.delete({ where: { id: taskId } }),
    })

    const relatedProjectIds = [
      existing.taskList.projectId,
      ...existing.taskProjects.map((taskProject) => taskProject.projectId),
    ]
    for (const projectId of Array.from(new Set(relatedProjectIds))) {
      emitTaskDeleted(projectId, taskId)
    }

    // auditLogId (additive, 12 Oct 2026): the web's Undo puts the task back through /api/tasks/undo-delete.
    return NextResponse.json({ message: "Task deleted", auditLogId })
  } catch (error) {
    console.error("Error deleting task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
