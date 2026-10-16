export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { validateBody } from "@/lib/validations"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { checkProjectAccess } from "@/lib/rbac"
import { emitTaskUpdated } from "@/lib/socket-emitter"
import { TASK_ORDER } from "@/lib/task-order"

const idString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id")
const schema = z
  .object({
    taskListId: idString,
    /** Whole order (the first web build, 12 Oct): the section's tasks top first; the ones left out keep their place after these. */
    orderedIds: z.array(idString).min(1).max(1000).optional(),
    /**
     * A relative move (race audit 16 Oct 2026, M12): these tasks, in this order, go right before `beforeId`
     * (or right after `afterId`; neither = to the end), applied to the order stored NOW.
     */
    movedIds: z.array(idString).min(1).max(1000).optional(),
    beforeId: idString.nullable().optional(),
    afterId: idString.nullable().optional(),
    /** The task that was dragged: its `task-updated` event tells other screens to refetch. */
    movedId: idString.optional(),
  })
  .refine((b) => !!b.orderedIds || !!b.movedIds, { message: "orderedIds or movedIds is required" })

/**
 * POST /api/tasks/reorder — manual order inside a Board column / section (web, 12 Oct 2026). Additive: the
 * apps keep PATCH /api/tasks/[taskId] { position }. Sets Task.position = 0..n-1 for the section's top-level
 * tasks, in one transaction. MEMBER of the section's project, like creating a task.
 *
 * Race audit 16 Oct 2026, M12: the order was read, then rewritten from the client's whole list, with nothing
 * held in between. Two people dragging in one column each sent the order they saw: 20 drags at once kept 0 of
 * the 20 moves (the last whole list won) and left duplicate positions. Now:
 *  - every writer of a section's order takes pg_advisory_xact_lock('tl:<taskListId>') and reads the order
 *    inside it, so writes never interleave and positions stay 0..n-1;
 *  - `movedIds` + `beforeId`/`afterId` is applied to THAT order, so concurrent drags of different cards all
 *    land, like one after the other. A `beforeId`/`afterId` that is no longer in the section (moved away,
 *    deleted) or is itself being moved answers 409 REORDER_ANCHOR_GONE with the order as it is now;
 *  - `orderedIds` (whole list) still works for older clients and the web's undo: last writer wins, as before,
 *    but atomically.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { allowed: rl, resetAt } = checkRateLimit(request, session.user.id, { limit: 60, windowSeconds: 60 })
    if (!rl) return rateLimitResponse(resetAt)

    const validation = validateBody(schema, await request.json())
    if (!validation.success) return validation.error
    const { taskListId, orderedIds, movedIds, beforeId, afterId, movedId } = validation.data

    const list = await prisma.taskList.findUnique({ where: { id: taskListId }, select: { projectId: true } })
    if (!list) return NextResponse.json({ error: "Section not found" }, { status: 404 })
    if (!(await checkProjectAccess(session.user.id, list.projectId, ["MEMBER"])).allowed) {
      return NextResponse.json({ error: "Forbidden: you need Can edit access in this project", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
    }

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tl:${taskListId}`})::int8)`
      const inList = await tx.task.findMany({ where: { taskListId, parentId: null }, select: { id: true, position: true }, orderBy: TASK_ORDER })
      const ids = inList.map((t) => t.id)
      const known = new Set(ids)
      let full: string[]
      let movedFirst: string | undefined = movedId
      if (movedIds) {
        const moving = Array.from(new Set(movedIds)).filter((id) => known.has(id))
        if (!moving.length) return { full: ids, writes: 0, moved: undefined }
        const set = new Set(moving)
        const rest = ids.filter((id) => !set.has(id))
        const anchor = beforeId ?? afterId ?? null
        if (anchor && (!known.has(anchor) || set.has(anchor))) return { gone: true as const, full: ids }
        const at = beforeId ? rest.indexOf(beforeId) : afterId ? rest.indexOf(afterId) + 1 : rest.length
        full = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
        movedFirst = movedId ?? moving[0]
      } else {
        const order = Array.from(new Set(orderedIds!)).filter((id) => known.has(id))
        const listed = new Set(order)
        full = [...order, ...ids.filter((id) => !listed.has(id))]
      }
      const current = new Map(inList.map((t) => [t.id, t.position]))
      const writes = full.map((id, i) => ({ id, i })).filter(({ id, i }) => current.get(id) !== i)
      for (const { id, i } of writes) await tx.task.update({ where: { id }, data: { position: i } })
      return { full, writes: writes.length, moved: movedFirst && known.has(movedFirst) ? movedFirst : undefined }
    }, { timeout: 20_000, maxWait: 10_000 })
    if ("gone" in outcome) {
      return NextResponse.json(
        { error: "The task you dropped next to moved meanwhile. The column was refreshed; drop it again.", code: "REORDER_ANCHOR_GONE", order: outcome.full },
        { status: 409 },
      )
    }
    const { full, writes } = outcome
    const moved = outcome.moved
      ? await prisma.task.findUnique({ where: { id: outcome.moved }, include: { assignees: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } }, taskList: true } })
      : null
    // `listOrder` (additive, 13 Oct 2026): the section's whole new order, so open boards place every card
    // without refetching the project (the other tasks' positions changed too but get no event of their own).
    if (moved && writes) emitTaskUpdated(list.projectId, { ...JSON.parse(JSON.stringify(moved)), listOrder: { taskListId, ids: full } })
    return NextResponse.json({ ok: true, updated: writes, order: full })
  } catch (error) {
    console.error("Error reordering tasks:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
