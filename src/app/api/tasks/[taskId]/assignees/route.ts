export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { notifyTaskAssigned } from "@/lib/notification-service"
import { checkProjectAccess } from "@/lib/rbac"
import { announceTaskChanged } from "@/lib/project-realtime"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const task = await prisma.task.findUnique({
      where: { id: (await params).taskId },
      include: { taskList: { include: { project: true } } },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Authz: only a member (contributor) of the task's project may change its assignees.
    const access = await checkProjectAccess(session.user.id!, task.taskList.projectId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const existing = await prisma.taskAssignee.findUnique({
      where: {
        taskId_userId: {
          taskId: (await params).taskId,
          userId,
        },
      },
    })

    if (existing) {
      return NextResponse.json({ error: "User is already assigned" }, { status: 400 })
    }

    // Two taps (or two people) assigning the same person at once both passed the check above; the second insert
    // hit the unique key and answered 500, after which both sent a notification (race audit 16 Oct 2026, M13).
    // The key decides now: the loser gets the same 400 as a sequential second tap, and sends nothing.
    let assignee
    try {
      assignee = await prisma.taskAssignee.create({
        data: {
          taskId: (await params).taskId,
          userId,
        },
        include: { user: true },
      })
    } catch (error) {
      if (isUniqueViolation(error)) return NextResponse.json({ error: "User is already assigned" }, { status: 400 })
      throw error
    }

    await prisma.activityLog.create({
      data: {
        action: "added assignee",
        details: `Added assignee to "${task.title}"`,
        userId: session.user.id!,
        taskId: (await params).taskId,
        projectId: task.taskList.projectId,
      },
    })

    // Send notification to the assignee (not when you assign yourself: QA S-16; don't block the response)
    notifyTaskAssigned({
      assigneeId: userId,
      taskId: (await params).taskId,
      taskTitle: task.title,
      projectName: task.taskList.project.name,
      projectId: task.taskList.projectId,
      assignedByName: session.user.name || "Someone",
      actorId: session.user.id,
    }).catch((err) => console.error("Notification error:", err))

    logAudit({ action: "create", entityType: "task_assignee", entityId: (await params).taskId, entityName: task.title, userId: session.user.id!, request, metadata: { assigneeUserId: userId } })

    // Open boards redraw the card (project realtime gaps, 19 Oct 2026): this route bypasses applyTaskUpdate.
    void announceTaskChanged((await params).taskId)
    return NextResponse.json(assignee, { status: 201 })
  } catch (error) {
    console.error("Error adding assignee:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const task = await prisma.task.findUnique({
      where: { id: (await params).taskId },
      include: { taskList: true },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Authz: only a member (contributor) of the task's project may change its assignees.
    const access = await checkProjectAccess(session.user.id!, task.taskList.projectId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const existing = await prisma.taskAssignee.findUnique({
      where: {
        taskId_userId: {
          taskId: (await params).taskId,
          userId,
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Assignee not found" }, { status: 404 })
    }

    // deleteMany, not delete: a removal that lost the race to another one is the same 404 as a sequential repeat,
    // not a 500 (P2025), and writes no second activity row.
    const removed = await prisma.taskAssignee.deleteMany({ where: { taskId: (await params).taskId, userId } })
    if (removed.count === 0) return NextResponse.json({ error: "Assignee not found" }, { status: 404 })

    await prisma.activityLog.create({
      data: {
        action: "removed assignee",
        details: `Removed assignee from "${task.title}"`,
        userId: session.user.id!,
        taskId: (await params).taskId,
        projectId: task.taskList.projectId,
      },
    })

    logAudit({ action: "delete", entityType: "task_assignee", entityId: (await params).taskId, entityName: task.title, userId: session.user.id!, request, metadata: { removedUserId: userId } })

    void announceTaskChanged((await params).taskId)
    return NextResponse.json({ message: "Assignee removed" })
  } catch (error) {
    console.error("Error removing assignee:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
