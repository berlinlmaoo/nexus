export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { validateBody } from "@/lib/validations"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { applyTaskUpdate } from "@/lib/task-update"

const idString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id")

const batchMoveSchema = z.object({
  taskIds: z.array(idString).min(1).max(200),
  taskListId: idString.optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]).optional(),
  projectContextId: idString.optional(),
}).refine((b) => b.taskListId !== undefined || b.status !== undefined || b.priority !== undefined, {
  message: "Nothing to move: give taskListId, status or priority",
})

/**
 * POST /api/tasks/batch-move — move many tasks to one column in one request (web multi-drag, 12 Oct 2026).
 * Additive: released apps keep using PATCH /api/tasks/[taskId], which this does NOT replace.
 *
 * Body: { taskIds (1–200), taskListId?, status?, priority?, projectContextId? }. Every task gets exactly the
 * edit PATCH /api/tasks/[taskId] would make with { taskListId, status, priority, projectContextId } —
 * the same function (lib/task-update.ts): access check per task, section ↔ status, done stamps, recurring
 * follow-up, activity log, audit, notifications, automations, and a `task-updated` socket event
 * per task (what the apps listen to). Tasks are applied one after another, in the order given.
 *
 * Answer: { moved: string[], failed: { id, error }[] } — 200 even when some failed (each refusal is
 * the PATCH's own error text: "Forbidden…", "Task not found", …).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // One drag = one request; PATCH allows 60 a minute, so 30 batches of up to 200 is plenty.
    const { allowed, resetAt } = checkRateLimit(request, session.user.id!, { limit: 30, windowSeconds: 60 })
    if (!allowed) return rateLimitResponse(resetAt)

    const validation = validateBody(batchMoveSchema, await request.json())
    if (!validation.success) return validation.error
    const { taskIds, ...fields } = validation.data
    const body: Record<string, string> = {}
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) body[k] = v

    const moved: string[] = []
    const failed: { id: string; error: string }[] = []
    for (const id of Array.from(new Set(taskIds))) {
      try {
        const res = await applyTaskUpdate({ request, session, taskId: id, body: { ...body } })
        if (res.ok) moved.push(id)
        else {
          const payload = (await res.json().catch(() => null)) as { error?: unknown } | null
          failed.push({ id, error: typeof payload?.error === "string" ? payload.error : `HTTP ${res.status}` })
        }
      } catch (error) {
        console.error("batch-move: task update failed", id, error)
        failed.push({ id, error: "Internal server error" })
      }
    }
    return NextResponse.json({ moved, failed })
  } catch (error) {
    console.error("Error moving tasks:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
