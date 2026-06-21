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
} as const
