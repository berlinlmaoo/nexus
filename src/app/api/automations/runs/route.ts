export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"

/**
 * GET /api/automations/runs?automationId=…[&limit=50][&before=<ISO>] → { runs, hasMore }
 * The run log of one automation, newest first (12 Oct 2026). Anyone who can see the project's automations
 * can read it. Each run names its task (title, when it still exists) and its actor.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sp = req.nextUrl.searchParams
    const automationId = sp.get("automationId")
    if (!automationId) return NextResponse.json({ error: "automationId required" }, { status: 400 })
    const automation = await prisma.automation.findUnique({ where: { id: automationId }, select: { projectId: true } })
    if (!automation) return NextResponse.json({ error: "Automation not found" }, { status: 404 })
    const { allowed } = await checkProjectAccess(session.user.id, automation.projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 50))
    const before = sp.get("before")
    const beforeDate = before && Number.isFinite(Date.parse(before)) ? new Date(before) : null
    const rows = await prisma.automationRun.findMany({
      where: { automationId, ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    })
    const page = rows.slice(0, limit)
    const taskIds = Array.from(new Set(page.map((r) => r.taskId).filter((x): x is string => !!x)))
    const actorIds = Array.from(new Set(page.map((r) => r.actorId).filter((x): x is string => !!x)))
    const [tasks, actors] = await Promise.all([
      taskIds.length ? prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } }) : [],
      actorIds.length ? prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, avatar: true } }) : [],
    ])
    const taskById = new Map(tasks.map((t) => [t.id, t]))
    const actorById = new Map(actors.map((a) => [a.id, a]))
    return NextResponse.json({
      runs: page.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        event: r.event,
        trigger: r.trigger,
        status: r.status,
        steps: r.steps ?? [],
        error: r.error,
        durationMs: r.durationMs,
        taskId: r.taskId,
        task: r.taskId ? taskById.get(r.taskId) ?? null : null,
        actor: r.actorId ? actorById.get(r.actorId) ?? null : null,
      })),
      hasMore: rows.length > limit,
    })
  } catch (error) {
    console.error("Error fetching automation runs:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
