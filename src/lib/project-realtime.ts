import prisma from "./prisma"
import { eventBus, BUS_EVENTS } from "./event-bus"
import { emitTaskUpdated } from "./socket-emitter"
import { createLogger } from "./logger"

const log = createLogger("project-realtime")

/**
 * What moved inside a project (project realtime gaps, 19 Oct 2026). Each kind names the screens that refetch:
 *  - "task"           `id` = task id: its open detail (activity, attachments, followers, dependencies, relations,
 *                     time entries). The card itself moves with `task-updated`.
 *  - "tasks"          the project's task payload (board/list/table/calendar/timeline): a task linked into or out of
 *                     the project, a workflow bundle applied. `id` = task id or null.
 *  - "forms"          the project's forms list (a form made, renamed, its settings changed, deleted). `id` = form id.
 *  - "sheets"         the project's sheet tabs (made, renamed, reordered, deleted). `id` = sheet id or null.
 *  - "sheet-comments" a sheet's cell comment threads. `id` = sheet id.
 *  - "status-updates" the Overview's status updates.
 *  - "members"        the member list and pending invites (an invite sent or revoked).
 *  - "pages"          the legacy project pages (ProjectPage). `id` = page id.
 *  - "files"          the project's files. `id` = file id or null.
 */
export type ProjectChangedKind =
  | "task"
  | "tasks"
  | "forms"
  | "sheets"
  | "sheet-comments"
  | "status-updates"
  | "members"
  | "pages"
  | "files"

/**
 * `project-changed` { projectId, kind, id, actorId } to the `project:<id>` room. A ping: ids only, never names or
 * values, and the room only holds sockets the server admitted with VIEWER access to the project (private projects
 * stay private). The socket server folds a burst per (project, kind, id). Never throws.
 */
export function emitProjectContentChanged(projectId: string | null | undefined, kind: ProjectChangedKind, id: string | null = null, actorId?: string | null) {
  if (!projectId) return
  try {
    eventBus.emit(BUS_EVENTS.PROJECT_CHANGED, { projectId, kind, id: id ?? null, actorId: actorId ?? null })
  } catch (error) {
    log.warn("project-changed listener failed", { error: String(error) })
  }
}

/** The projects a task shows in: its home project and every project it is linked into. */
async function projectsOfTask(taskId: string): Promise<string[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { taskList: { select: { projectId: true } }, taskProjects: { select: { projectId: true } } },
  })
  if (!task) return []
  return Array.from(new Set([task.taskList?.projectId, ...task.taskProjects.map((tp) => tp.projectId)].filter((x): x is string => !!x)))
}

/**
 * A task's side data changed (attachments, followers, dependencies, relations, time entries): `project-changed`
 * { kind: "task", id: taskId } to each project it shows in. Never throws: the write already succeeded.
 */
export async function pingTaskDetail(taskId: string | null | undefined, actorId?: string | null): Promise<void> {
  if (!taskId) return
  try {
    for (const pid of await projectsOfTask(taskId)) emitProjectContentChanged(pid, "task", taskId, actorId)
  } catch (error) {
    log.warn("task detail ping failed", { taskId, error: String(error) })
  }
}

/**
 * A task's card changed without going through applyTaskUpdate (assignees route, linked projects): the fresh row,
 * in the same shape task-update.ts announces, as `task-updated` to each project it shows in. Never throws.
 */
export async function announceTaskChanged(taskId: string | null | undefined, extraProjectIds: string[] = []): Promise<void> {
  if (!taskId) return
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignees: { include: { user: true } },
        creator: true,
        taskList: true,
        taskProjects: { select: { projectId: true } },
        _count: { select: { subtasks: true, comments: true } },
      },
    })
    if (!task) return
    const { taskProjects, ...row } = task
    const payload = JSON.parse(JSON.stringify(row)) as Record<string, unknown>
    const pids = new Set([task.taskList?.projectId, ...taskProjects.map((tp) => tp.projectId), ...extraProjectIds].filter((x): x is string => !!x))
    for (const pid of pids) emitTaskUpdated(pid, payload)
  } catch (error) {
    log.warn("task announce failed", { taskId, error: String(error) })
  }
}
