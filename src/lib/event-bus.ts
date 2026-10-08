import { EventEmitter } from "events"

// Global event bus for server-side communication between
// App Router API routes and the Pages API Socket.IO server.
// API routes publish events here; the socket server subscribes
// and broadcasts to connected clients.

const globalForBus = globalThis as unknown as { __eventBus?: EventEmitter }

export const eventBus: EventEmitter = globalForBus.__eventBus ?? new EventEmitter()

if (!globalForBus.__eventBus) {
  eventBus.setMaxListeners(50)
  globalForBus.__eventBus = eventBus
}

// Event name constants
export const BUS_EVENTS = {
  TASK_CREATED: "task-created",
  TASK_UPDATED: "task-updated",
  TASK_DELETED: "task-deleted",
  COMMENT_ADDED: "comment-added",
  NOTIFICATION: "notification",
  SPRINT_UPDATED: "sprint-updated",
  MESSAGE_CREATED: "message-created",
  /** A conversation changed for these users (new message, read, mute, membership) → `user:<id>` rooms. */
  CONVERSATION_UPDATED: "conversation-updated",
  /** People left a conversation: their sockets must leave `conversation:<id>`. */
  CONVERSATION_MEMBERSHIP: "conversation-membership",
  SHEET_CELLS: "sheet-cells",
  SHEET_STRUCTURE: "sheet-structure",
  /** Projects or folders of a workspace changed → `workspace:<id>` (+ named `user:<id>`) rooms. An invalidation ping, no data. */
  WORKSPACE_CHANGED: "workspace-changed",
  /** An audit row was written (or a restore landed) → the server-assigned `audit` room. No data. */
  AUDIT_CHANGED: "audit-changed",
} as const
