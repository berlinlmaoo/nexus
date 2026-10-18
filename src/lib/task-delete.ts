import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { deleteKeepingSnapshot } from "@/lib/deletion-snapshot"
import { isRecordNotFound } from "@/lib/prisma-errors"
import { checkProjectAccess } from "@/lib/rbac"
import { emitTaskDeleted } from "@/lib/socket-emitter"

/**
 * Deleting one task: the ONE path for DELETE /api/tasks/:taskId and GIDEON's delete_task (owner, 18 Oct 2026).
 *
 * Rule (Notion levels, owner 13 Oct 2026): Can edit (MEMBER) in the task's home project deletes it. The delete is
 * restorable: the audit row first, then every row the delete takes with it is copied into DeletionSnapshot in the
 * same transaction (no copy = no delete), so Control Room → Audit can put it back. Then the realtime ping to every
 * project the task shows in.
 *
 * `expectedUpdatedAt`: delete only the task as it was when this was asked (GIDEON's card showed it then). A task
 * changed in between is refused with CHANGED and nothing is deleted — the conditional delete runs inside the
 * snapshot transaction, so the check and the delete cannot be split by another write.
 */
export type TaskDeleteRefusalCode = "NOT_FOUND" | "NEEDS_EDIT_ACCESS" | "CHANGED"

export class TaskDeleteRefusal extends Error {
  constructor(message: string, readonly code: TaskDeleteRefusalCode, readonly status: number) {
    super(message)
  }
}

export const TASK_DELETE_MESSAGES = {
  NOT_FOUND: "Task not found",
  NEEDS_EDIT_ACCESS: "Forbidden: you need Can edit access in this project to delete tasks",
  CHANGED: "This task changed after it was shown to you. Nothing was deleted; check the task and ask again.",
} as const

export async function deleteTaskAs(
  userId: string,
  taskId: string,
  opts: { request?: Request; expectedUpdatedAt?: string | null; via?: "GIDEON" } = {},
): Promise<{ auditLogId: string | null; task: { id: string; title: string; projectId: string; projectName: string | null } }> {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      taskList: { include: { project: { select: { name: true, workspaceId: true } } } },
      taskProjects: { select: { projectId: true } },
    },
  })
  if (!existing) throw new TaskDeleteRefusal(TASK_DELETE_MESSAGES.NOT_FOUND, "NOT_FOUND", 404)

  const { allowed } = await checkProjectAccess(userId, existing.taskList.projectId, ["MEMBER"])
  if (!allowed) throw new TaskDeleteRefusal(TASK_DELETE_MESSAGES.NEEDS_EDIT_ACCESS, "NEEDS_EDIT_ACCESS", 403)

  const expected = opts.expectedUpdatedAt ? new Date(opts.expectedUpdatedAt) : null
  if (expected && !Number.isNaN(expected.getTime()) && existing.updatedAt.getTime() !== expected.getTime()) {
    throw new TaskDeleteRefusal(TASK_DELETE_MESSAGES.CHANGED, "CHANGED", 409)
  }
  const projectId = existing.taskList.projectId
  const projectName = existing.taskList.project?.name ?? null

  const auditLogId = await logAudit({
    action: "delete", entityType: "task", entityId: taskId, entityName: existing.title,
    userId, request: opts.request,
    // The task is gone after this; keep enough to say what it was and where it lived.
    metadata: { title: existing.title, projectId, projectName, ...(opts.via ? { via: opts.via } : {}) },
  })

  try {
    // Everything the delete takes with it (subtasks, files, comments…) is kept first, so Control Room →
    // Audit can restore it.
    await deleteKeepingSnapshot({
      entityType: "task", entityId: taskId, entityName: existing.title,
      workspaceId: existing.taskList.project?.workspaceId ?? null,
      deletedById: userId, auditLogId,
      meta: { open: { type: "task", id: taskId, projectId }, projectId, taskId },
      remove: (tx) => tx.task.delete({ where: { id: taskId, ...(expected && !Number.isNaN(expected.getTime()) ? { updatedAt: expected } : {}) } }),
    })
  } catch (error) {
    // Deleted or changed by someone else between the read and the delete: nothing was removed (the copy rolled
    // back with it), so the audit row that announced the delete goes too.
    if (isRecordNotFound(error)) {
      if (auditLogId) await prisma.auditLog.delete({ where: { id: auditLogId } }).catch(() => undefined)
      const still = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } })
      throw still
        ? new TaskDeleteRefusal(TASK_DELETE_MESSAGES.CHANGED, "CHANGED", 409)
        : new TaskDeleteRefusal(TASK_DELETE_MESSAGES.NOT_FOUND, "NOT_FOUND", 404)
    }
    throw error
  }

  await prisma.activityLog.create({
    data: {
      action: "deleted task",
      details: `Deleted task "${existing.title}"${opts.via ? ` (via ${opts.via})` : ""}`,
      userId,
      projectId,
    },
  })

  for (const pid of Array.from(new Set([projectId, ...existing.taskProjects.map((tp) => tp.projectId)]))) {
    emitTaskDeleted(pid, taskId)
  }
  return { auditLogId, task: { id: taskId, title: existing.title, projectId, projectName } }
}
