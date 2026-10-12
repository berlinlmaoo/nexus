export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { validateBody } from "@/lib/validations"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { checkProjectAccess } from "@/lib/rbac"
import { emitTaskUpdated } from "@/lib/socket-emitter"

const idString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id")
const schema = z.object({
  taskListId: idString,
  /** The section's tasks in their new order, top first (the ones left out keep their place after these). */
  orderedIds: z.array(idString).min(1).max(1000),
  /** The task that was dragged: its `task-updated` event tells other screens to refetch. */
  movedId: idString.optional(),
})

/**
 * POST /api/tasks/reorder — manual order inside a Board column / section (web, 12 Oct 2026). Additive: the
 * apps keep PATCH /api/tasks/[taskId] { position }. Sets Task.position = 0..n-1 in the order given, for the
 * section's top-level tasks only, in one transaction. MEMBER of the section's project, like creating a task.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { allowed: rl, resetAt } = checkRateLimit(request, session.user.id, { limit: 60, windowSeconds: 60 })
    if (!rl) return rateLimitResponse(resetAt)

    const validation = validateBody(schema, await request.json())
    if (!validation.success) return validation.error
    const { taskListId, orderedIds, movedId } = validation.data

    const list = await prisma.taskList.findUnique({ where: { id: taskListId }, select: { projectId: true } })
    if (!list) return NextResponse.json({ error: "Section not found" }, { status: 404 })
    if (!(await checkProjectAccess(session.user.id, list.projectId, ["MEMBER"])).allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    const inList = await prisma.task.findMany({
      where: { taskListId, parentId: null },
      select: { id: true, position: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }], // the board's order
    })
    const known = new Set(inList.map((t) => t.id))
    const order = Array.from(new Set(orderedIds)).filter((id) => known.has(id))
    const listed = new Set(order)
    const full = [...order, ...inList.filter((t) => !listed.has(t.id)).map((t) => t.id)]
    const current = new Map(inList.map((t) => [t.id, t.position]))
    const writes = full.map((id, i) => ({ id, i })).filter(({ id, i }) => current.get(id) !== i)
    if (writes.length) {
      await prisma.$transaction(writes.map(({ id, i }) => prisma.task.update({ where: { id }, data: { position: i } })))
    }
    const moved = movedId && known.has(movedId)
      ? await prisma.task.findUnique({ where: { id: movedId }, include: { assignees: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } }, taskList: true } })
      : null
    if (moved && writes.length) emitTaskUpdated(list.projectId, JSON.parse(JSON.stringify(moved)))
    return NextResponse.json({ ok: true, updated: writes.length })
  } catch (error) {
    console.error("Error reordering tasks:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
