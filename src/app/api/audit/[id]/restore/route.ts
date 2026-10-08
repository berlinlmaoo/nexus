export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { resolveAuditAccess } from "@/lib/audit-query"
import { restoreDeletion } from "@/lib/deletion-snapshot"
import { entityLabelOf } from "@/lib/deletion-entities"
import { afterRestore } from "@/lib/deletion-restore-followup"
import { syncProjectRoomSafe } from "@/lib/chat-membership"
import { emitAuditChanged, emitWorkspaceChanged } from "@/lib/socket-emitter"

/**
 * Restore what a delete removed (owner, 8 Oct 2026; every kind of delete since the same day — the list
 * is lib/deletion-entities.ts RESTORABLE). Who may: whoever may see the entry in Control Room → Audit
 * (same rule as GET /api/audit/[id]; an entry outside the caller's scope is a 404).
 *
 * 200 { ok, entityType, entityId, entityLabel, projectId, open,
 *       restored: { lists, tasks, files, comments, folders, items } }
 * 404 { code: "NOT_RESTORABLE" } — no copy was kept (deletes before 8 Oct 2026, or not a delete)
 * 409 { code: "ALREADY_RESTORED" | "ALREADY_EXISTS" | "PARENT_MISSING" | "CONFLICT", entityType,
 *       parent } — `parent` on PARENT_MISSING: the noun of what has to come back first ("task"…), or null
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
    // Any entry with a copy: deletes, and the few deletes logged under their own verb (a revoke).
    if (!row) {
      return NextResponse.json({ error: "There is no copy of this to restore.", code: "NOT_RESTORABLE" }, { status: 404 })
    }

    const outcome = await restoreDeletion(row.id, session.user.id)
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.message, code: outcome.code, entityType: outcome.entityType, parent: outcome.parent },
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
    } else if (outcome.entityType === "project") {
      // The project's chat room came back with its members as they were; today's members decide.
      await syncProjectRoomSafe(outcome.entityId, "project restored")
    } else {
      // Everything else: the realtime pings for its kind, and the project it lives in (if any).
      projectId = (await afterRestore({
        entityType: outcome.entityType, entityId: outcome.entityId, meta: outcome.meta, actorId: session.user.id,
      })).projectId
    }

    const items = Object.values(inserted).reduce((a, b) => a + b, 0)
    const restored = {
      lists: inserted.TaskList ?? 0,
      tasks: Math.max(0, (inserted.Task ?? 0) - (outcome.entityType === "task" ? 1 : 0)),
      files: inserted.Attachment ?? 0,
      comments: inserted.Comment ?? 0,
      folders: foldersCreated,
      items,
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
        rows: items,
        skipped,
        relinked,
      },
    })

    // Live for everyone (owner, 8 Oct 2026): the project and the folder it brought back appear in every
    // open sidebar, projects page and folder page of its workspace (and of its members outside it), and
    // every open Control Room → Audit, list and drawer, flips this entry to "Restored by …". logAudit
    // above pings the audit too; this one is explicit so a failed audit write cannot leave the other
    // screens on "Restore". A failed lookup only costs the workspace ping, never the restore's 200.
    if (outcome.entityType === "project" || outcome.entityType === "task") {
      const target = projectId
        ? await prisma.project
          .findUnique({ where: { id: projectId }, select: { workspaceId: true, members: { select: { userId: true } } } })
          .catch(() => null)
        : null
      const memberIds = target?.members.map((m) => m.userId) ?? []
      emitWorkspaceChanged(target?.workspaceId, { kind: "projects", projectId: projectId ?? undefined, actorId: session.user.id }, memberIds)
      emitWorkspaceChanged(target?.workspaceId, { kind: "folders", actorId: session.user.id }, memberIds)
    }
    emitAuditChanged()

    // `open`: where the restored thing is shown (copies from before `meta` existed: projects and tasks).
    const open = outcome.meta && "open" in outcome.meta
      ? outcome.meta.open ?? null
      : outcome.entityType === "project" || outcome.entityType === "task"
        ? { type: outcome.entityType, id: outcome.entityId }
        : null
    return NextResponse.json({
      ok: true, entityType: outcome.entityType, entityId: outcome.entityId, entityLabel: entityLabelOf(outcome.entityType),
      projectId, open, restored,
    })
  } catch (error) {
    console.error("Audit restore error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
