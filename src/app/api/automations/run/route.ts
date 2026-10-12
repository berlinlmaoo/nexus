export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { runAutomationNow } from "@/lib/automation-engine"

/**
 * POST /api/automations/run { id, taskId? } → { run }
 * "Run now" from the builder (12 Oct 2026): fires the rule once, by hand, as the caller. With a task the
 * conditions are checked against it and task actions act on it; without one only task-free actions run
 * (create task, notify). LEAD only, like editing. The run lands in the log as "manual".
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const id = typeof body?.id === "string" ? body.id : ""
    const taskId = typeof body?.taskId === "string" && body.taskId ? body.taskId : undefined
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
    const automation = await prisma.automation.findUnique({ where: { id }, select: { projectId: true } })
    if (!automation) return NextResponse.json({ error: "Automation not found" }, { status: 404 })
    const { allowed } = await checkProjectAccess(session.user.id, automation.projectId, ["LEAD"])
    if (!allowed) return NextResponse.json({ error: "Forbidden: you need Full access to the project to run automations" }, { status: 403 })
    if (taskId) {
      const task = await prisma.task.findFirst({ where: { id: taskId, taskList: { projectId: automation.projectId } }, select: { id: true } })
      if (!task) return NextResponse.json({ error: "Task not found in this project" }, { status: 404 })
    }
    const run = await runAutomationNow(id, { kind: "manual", actorId: session.user.id, taskId }, { manual: true })
    if (!run) return NextResponse.json({ run: null, skipped: true, reason: "The conditions did not match (pick a task that meets them)" })
    return NextResponse.json({ run })
  } catch (error) {
    console.error("Error running automation:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
