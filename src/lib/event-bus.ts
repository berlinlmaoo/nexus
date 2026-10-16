import { EventEmitter } from "events"

// Global event bus for server-side communication between
// App Router API routes and the Pages API Socket.IO server.
// API routes publish events here; the socket server subscribes
// and broadcasts to connected clients.

// Blue-green (race audit 16 Oct 2026, M19): two app processes share one database and a socket is attached to
// only one of them, so an event emitted in one process never reached the sockets of the other (a write served
// by the old slot just after a switch, or by the new slot while tabs were still on the old one). Every
// BUS_EVENTS emit is therefore also handed to the cross-process bridge (lib/realtime-bridge.ts, Postgres
// NOTIFY), which re-delivers it in the OTHER process with `deliverRemote`. A socket lives in exactly one
// process, so each client still gets each event once. Nothing is published until the bridge installs its
// hook (instrumentation.ts): tests and scripts stay in-process.
type BusPublish = (event: string, data: unknown) => void

const globalForBus = globalThis as unknown as { __eventBus?: BusEmitter; __busPublish?: BusPublish | null }

const BRIDGED = new Set<string>()

class BusEmitter extends EventEmitter {
  /** True while an event from the other process is delivered here: never published back. */
  private remote = false

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const delivered = super.emit(event, ...args)
    const publish = globalForBus.__busPublish
    if (publish && !this.remote && typeof event === "string" && BRIDGED.has(event)) {
      try { publish(event, args[0]) } catch { /* the bridge never fails a write */ }
    }
    return delivered
  }

  /** Deliver an event published by another process to this process's listeners only. */
  deliverRemote(event: string, data: unknown): void {
    if (!BRIDGED.has(event)) return
    this.remote = true
    try { super.emit(event, data) } finally { this.remote = false }
  }
}

export const eventBus: BusEmitter = globalForBus.__eventBus ?? new BusEmitter()

/** Installed by lib/realtime-bridge.ts; null turns publishing off. */
export function setBusPublisher(fn: BusPublish | null): void {
  globalForBus.__busPublish = fn
}

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
  /** A deal of a Pipeline Dashboard project changed → the `project:<id>` room. Ids only (owner, 9 Oct 2026). */
  PIPELINE_CHANGED: "pipeline-changed",
  /** An event or target of an Outlet Sales Dashboard project changed → the `project:<id>` room. Ids only (owner, 10 Oct 2026). */
  OUTLET_SALES_CHANGED: "outlet-sales-changed",
  /** A day, target or platform of a Social Media Report project changed → the `project:<id>` room. Ids only (owner, 14 Oct 2026). */
  SOCIAL_MEDIA_CHANGED: "social-media-changed",
  /** A project's automations or their run log changed → the `project:<id>` room. Ids only (12 Oct 2026). */
  AUTOMATIONS_CHANGED: "automations-changed",
  /** A doc's body or header changed → `project:<id>` ("doc-changed", ids only) for lists and open pages (block editor, 12 Oct 2026). */
  DOC_CHANGED: "doc-changed",
  /** A block-editor body was written outside its live room (REST save, an app) → that room reloads (lib/collab-rooms.ts). */
  COLLAB_EXTERNAL_WRITE: "collab-external-write",
  /**
   * Someone's access to a project changed (removed, level changed, out of the workspace, offboarded): the
   * socket server re-checks those users' open project/sheet/live-page rooms at once and takes them out or
   * down to read-only (13 Oct 2026, realtime bugs 1-2). `projectId` null = every project; `userIds` null =
   * everyone in that project's rooms.
   */
  ACCESS_CHANGED: "access-changed",
  /** A form got a response (or lost one) → `project:<id>` ("form-responses-changed", ids only). */
  FORM_RESPONSES_CHANGED: "form-responses-changed",
} as const

// Every named event crosses processes (lib/realtime-bridge.ts).
for (const name of Object.values(BUS_EVENTS)) BRIDGED.add(name)
