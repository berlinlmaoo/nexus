import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import type { SnapshotMeta } from "@/lib/deletion-entities"
import { emitCommentAdded, emitSheetStructure, emitTaskCreated, emitTaskUpdated, emitWorkspaceChanged } from "@/lib/socket-emitter"
import { emitProjectChanged } from "@/lib/workspace-realtime"

const log = createLogger("deletion-restore")

/** Inside a task: the task's own screens and boards refetch. */
const TASK_TYPES = new Set(["comment", "attachment", "proof_annotation", "form_submission"])
/** Inside a project, drawn from the project's detail: its header/board refetches. */
const PROJECT_TYPES = new Set(["task_list", "project_page", "custom_field", "form", "automation", "project_sheet", "doc"])
/** Inside a sheet: open grids refetch their structure. */
const SHEET_TYPES = new Set(["project_sheet", "sheet_rows", "project_sheet_column", "sheet_comment"])

/**
 * After a restore has committed (POST /api/audit/[id]/restore), for every kind except projects and
 * tasks (the route keeps their own follow-ups): the realtime pings that make the thing reappear on
 * screens already open. Only pings that exist today — kinds with no realtime (Vault, attendance, org
 * chart, P&L…) show up on the next load; the audit itself is pinged by the route. Never throws: the
 * restore has already succeeded. Returns the project the thing lives in, when there is one.
 */
export async function afterRestore(input: {
  entityType: string
  entityId: string
  meta: SnapshotMeta | null
  actorId: string
}): Promise<{ projectId: string | null }> {
  const { entityType, meta, actorId } = input
  let projectId = meta?.projectId ?? null
  try {
    if (TASK_TYPES.has(entityType) && meta?.taskId) {
      const task = await prisma.task.findUnique({
        where: { id: meta.taskId },
        include: {
          assignees: { include: { user: true } },
          creator: true,
          taskList: true,
          taskProjects: { select: { projectId: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
      })
      if (task) {
        projectId = task.taskList.projectId
        const payload = JSON.parse(JSON.stringify(task))
        for (const pid of new Set([task.taskList.projectId, ...task.taskProjects.map((p) => p.projectId)])) {
          if (entityType === "form_submission") emitTaskCreated(pid, payload)
          else emitTaskUpdated(pid, payload)
        }
        if (entityType === "comment") {
          const comment = await prisma.comment.findUnique({
            where: { id: input.entityId },
            include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
          })
          if (comment) emitCommentAdded(task.taskList.projectId, task.id, JSON.parse(JSON.stringify(comment)))
        }
      }
    }
    if (PROJECT_TYPES.has(entityType) && projectId) {
      await emitProjectChanged(projectId, { actorId })
    }
    if (SHEET_TYPES.has(entityType) && meta?.sheetId) {
      emitSheetStructure(meta.sheetId, actorId)
    }
    if (entityType === "project_folder") {
      const folder = await prisma.projectFolder.findUnique({ where: { id: input.entityId }, select: { workspaceId: true } })
      emitWorkspaceChanged(folder?.workspaceId, { kind: "folders", folderId: input.entityId, actorId })
      emitWorkspaceChanged(folder?.workspaceId, { kind: "projects", actorId })
    }
  } catch (error) {
    log.warn("restore follow-up failed", { entityType, error: String(error) })
  }
  return { projectId }
}
