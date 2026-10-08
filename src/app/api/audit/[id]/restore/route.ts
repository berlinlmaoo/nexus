export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { resolveAuditAccess } from "@/lib/audit-query"
import { restoreDeletion } from "@/lib/deletion-snapshot"
import { syncProjectRoomSafe } from "@/lib/chat-membership"

/**
 * Restore what a delete removed (owner, 8 Oct 2026). Who may: whoever may see the entry in Control
 * Room → Audit (same rule as GET /api/audit/[id]; an entry outside the caller's scope is a 404).
 *
 * 200 { ok, entityType, entityId, projectId, restored: { lists, tasks, files, comments, folders } }
 * 404 { code: "NOT_RESTORABLE" } — not a delete, or no copy was kept (deletes before 8 Oct 2026)
 * 409 { code: "ALREADY_RESTORED" | "ALREADY_EXISTS" | "PARENT_MISSING" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const access = await resolveAuditAccess(session.user.id)
    if (!access.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    if (!id || id.length > 64) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const row = await prisma.auditLog.findFirst({
      where: { AND: [{ id }, access.scope] },
      select: { id: true, action: true },
    })
    if (!row || row.action !== "delete") {
      return NextResponse.json({ error: "There is no copy of this to restore.", code: "NOT_RESTORABLE" }, { status: 404 })
    }

    const outcome = await restoreDeletion(row.id, session.user.id)
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.message, code: outcome.code },
        { status: outcome.code === "NOT_RESTORABLE" ? 404 : 409 },
      )
    }

    const { inserted, foldersCreated, skipped, relinked } = outcome.result
    let projectId: string | null = outcome.entityType === "project" ? outcome.entityId : null
    if (outcome.entityType === "task") {
      const task = await prisma.task.findUnique({
        where: { id: outcome.entityId },
        select: { taskList: { select: { projectId: true } } },
      })
      projectId = task?.taskList.projectId ?? null
    } else {
      // The project's chat room came back with its members as they were; today's members decide.
      await syncProjectRoomSafe(outcome.entityId, "project restored")
    }

    const restored = {
      lists: inserted.TaskList ?? 0,
      tasks: Math.max(0, (inserted.Task ?? 0) - (outcome.entityType === "task" ? 1 : 0)),
      files: inserted.Attachment ?? 0,
      comments: inserted.Comment ?? 0,
      folders: foldersCreated,
    }
    await logAudit({
      action: "restore",
      entityType: outcome.entityType,
      entityId: outcome.entityId,
      entityName: outcome.entityName ?? undefined,
      userId: session.user.id,
      request,
      metadata: {
        restoredFrom: row.id,
        fromBackup: outcome.fromBackup,
        ...restored,
        rows: Object.values(inserted).reduce((a, b) => a + b, 0),
        skipped,
        relinked,
      },
    })

    return NextResponse.json({ ok: true, entityType: outcome.entityType, entityId: outcome.entityId, projectId, restored })
  } catch (error) {
    console.error("Audit restore error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
