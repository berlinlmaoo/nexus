export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess, isSystemAdminUser } from "@/lib/rbac"
import { canReadTask, taskReadRefusal, workspaceIdsOf } from "@/lib/read-access"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // Signed in is not enough (API.md E5): a task's log as its task, a project's as its page, and the
    // unfiltered feed only from the caller's own workspaces (it used to be every workspace's).
    const scopeTaskId = request.nextUrl.searchParams.get("taskId")
    const scopeProjectId = request.nextUrl.searchParams.get("projectId")
    if (scopeTaskId) {
      const readable = await canReadTask(session.user.id!, scopeTaskId)
      if (readable !== "ok") return taskReadRefusal(readable)
    }
    if (scopeProjectId && !(await checkProjectAccess(session.user.id!, scopeProjectId, ["VIEWER"])).allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const onlyWorkspaceIds =
      !scopeTaskId && !scopeProjectId && !(await isSystemAdminUser(session.user.id!))
        ? await workspaceIdsOf(session.user.id!)
        : null

    const searchParams = request.nextUrl.searchParams
    const projectId = searchParams.get("projectId")
    const taskId = searchParams.get("taskId")
    const limit = parseInt(searchParams.get("limit") || "20", 10)

    const where: Record<string, unknown> = {}

    if (projectId) {
      where.projectId = projectId
    }
    if (taskId) {
      where.taskId = taskId
    }
    if (onlyWorkspaceIds) {
      where.project = { workspaceId: { in: onlyWorkspaceIds } }
    }

    const activityLogs = await prisma.activityLog.findMany({
      where,
      include: {
        user: true,
        task: true,
        project: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    })

    return NextResponse.json(activityLogs)
  } catch (error) {
    console.error("Error fetching activity logs:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
