import { eventBus, BUS_EVENTS } from "./event-bus"

/** Emit a task-created event to all clients watching a project */
export function emitTaskCreated(projectId: string, task: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.TASK_CREATED, { projectId, task })
}

/** Emit a task-updated event to all clients watching a project */
export function emitTaskUpdated(projectId: string, task: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.TASK_UPDATED, { projectId, task })
}

/** Emit a task-deleted event to all clients watching a project */
export function emitTaskDeleted(projectId: string, taskId: string) {
  eventBus.emit(BUS_EVENTS.TASK_DELETED, { projectId, taskId })
}

/** Emit a comment-added event to all clients watching a project */
export function emitCommentAdded(projectId: string, taskId: string, comment: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.COMMENT_ADDED, { projectId, taskId, comment })
}

/** Emit a notification to a specific user's room */
export function emitNotification(userId: string, notification: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.NOTIFICATION, { userId, notification })
}

/** Emit a sprint-updated event to all clients watching a project */
export function emitSprintUpdated(projectId: string, sprint: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.SPRINT_UPDATED, { projectId, sprint })
}

/** Emit a chat message to everyone in a conversation room */
export function emitMessageCreated(conversationId: string, message: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.MESSAGE_CREATED, { conversationId, message })
}

/**
 * Push a just-written block of cells to everyone else looking at the sheet.
 *
 * Emitted from the API route, NOT relayed from the sender's browser: the payload is then whatever
 * the database actually accepted (already coerced to the column type), and no client can forge a
 * value into someone else's grid. Same direction every other event in this file travels.
 */
export function emitSheetCells(
  sheetId: string,
  rows: { id: string; cells: Record<string, unknown>; updatedAt: Date | string }[],
  actorId: string,
) {
  eventBus.emit(BUS_EVENTS.SHEET_CELLS, { sheetId, rows, actorId })
}

/** Rows added/removed/reordered, or columns changed — the receiver refetches rather than patches. */
export function emitSheetStructure(sheetId: string, actorId: string) {
  eventBus.emit(BUS_EVENTS.SHEET_STRUCTURE, { sheetId, actorId })
}
