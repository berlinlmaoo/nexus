export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { validateBody } from "@/lib/validations"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { checkProjectAccess } from "@/lib/rbac"
import { logAudit } from "@/lib/audit"
import { restoreDeletion } from "@/lib/deletion-snapshot"
import { emitAuditChanged, emitTaskCreated } from "@/lib/socket-emitter"

const idString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id")
const schema = z.object({ auditLogIds: z.array(idString).min(1).max(200) })

/** How long after a delete its own author may take it back with Undo (Control Room → Audit stays for later). */
const UNDO_WINDOW_MS = 30 * 60 * 1000

/**
 * POST /api/tasks/undo-delete — the web's Undo / Ctrl+Z after deleting tasks (12 Oct 2026). Additive: the
 * apps don't call it. Body { auditLogIds } — the ids DELETE /api/tasks/[taskId] answered with.
 *
 * Only the person who deleted, only within 30 minutes, only task deletes, and only while they may still
 * delete in that project (LEAD). Everything else goes through Control Room → Audit → Restore, which is the
 * same restore (lib/deletion-snapshot.ts) with the audit's own access rule.
 *
 * Answer: { restored: string[] (task ids), failed: { id (audit id), error }[] } — 200 even when some failed.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { allowed, resetAt } = checkRateLimit(request, userId, { limit: 30, windowSeconds: 60 })
    if (!allowed) return rateLimitResponse(resetAt)

    const validation = validateBody(schema, await request.json())
    if (!validation.success) return validation.error

    const restored: string[] = []
    const failed: { id: string; error: string }[] = []
    const since = new Date(Date.now() - UNDO_WINDOW_MS)
    for (const id of Array.from(new Set(validation.data.auditLogIds))) {
      try {
        const row = await prisma.auditLog.findFirst({
          where: { id, userId, action: "delete", entityType: "task", createdAt: { gte: since } },
          select: { id: true, entityId: true, metadata: true },
        })
        if (!row) { failed.push({ id, error: "Not found" }); continue }
        const projectId = (row.metadata as { projectId?: unknown } | null)?.projectId
        if (typeof projectId !== "string" || !(await checkProjectAccess(userId, projectId, ["MEMBER"])).allowed) {
          failed.push({ id, error: "Forbidden" }); continue
        }
        const outcome = await restoreDeletion(row.id, userId)
        if (!outcome.ok) { failed.push({ id, error: outcome.code }); continue }
        await logAudit({
          action: "restore", entityType: "task", entityId: outcome.entityId, entityName: outcome.entityName ?? undefined,
          userId, request, metadata: { restoredFrom: row.id, via: "undo" },
        })
        const task = await prisma.task.findUnique({ where: { id: outcome.entityId }, include: { taskList: { select: { projectId: true } } } })
        if (task) emitTaskCreated(task.taskList.projectId, JSON.parse(JSON.stringify(task)))
        restored.push(outcome.entityId)
      } catch (error) {
        console.error("undo-delete failed", id, error)
        failed.push({ id, error: "Internal server error" })
      }
    }
    if (restored.length) emitAuditChanged()
    return NextResponse.json({ restored, failed })
  } catch (error) {
    console.error("Error undoing task delete:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
