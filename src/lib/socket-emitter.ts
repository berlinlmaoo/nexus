import { eventBus, BUS_EVENTS } from "./event-bus"

/** Emit a task-created event to all clients watching a project */
export function emitTaskCreated(projectId: string, task: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.TASK_CREATED, { projectId, task })
}

/** Emit a task-updated event to all clients watching a project */
export function emitTaskUpdated(projectId: string, task: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.TASK_UPDATED, { projectId, task })
  pingSubmitterLater(typeof task?.id === "string" ? task.id : null)
}

/** A task a form submission made changed: its submitter's "My Submissions" refetches (lib/submission-ping.ts). */
function pingSubmitterLater(taskId: string | null) {
  if (!taskId) return
  void import("./submission-ping").then((m) => m.pingSubmitter(taskId)).catch(() => {})
}

/** Emit a task-deleted event to all clients watching a project */
export function emitTaskDeleted(projectId: string, taskId: string) {
  eventBus.emit(BUS_EVENTS.TASK_DELETED, { projectId, taskId })
}

/** Emit a comment-added event to all clients watching a project */
export function emitCommentAdded(projectId: string, taskId: string, comment: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.COMMENT_ADDED, { projectId, taskId, comment })
  pingSubmitterLater(taskId)
}

/**
 * Access to a project changed for these users (or, with `userIds` null, for whoever is in its rooms). The
 * socket server re-checks their open realtime rooms (project, sheet, live page) and evicts or downgrades
 * them; without this a removed member kept receiving events and could keep typing into an open page until
 * they reconnected. `projectId` null = re-check every project room those users are in (workspace removal,
 * offboarding, a role change). Never throws; safe to call inside a transaction (the server re-checks
 * twice, shortly after and a couple of seconds later, so a write committed a moment later is still seen).
 */
export function emitAccessChanged(projectId: string | null, userIds: Array<string | null | undefined> | null) {
  const ids = userIds === null ? null : Array.from(new Set(userIds.filter((x): x is string => typeof x === "string" && !!x)))
  if (ids !== null && ids.length === 0) return
  eventBus.emit(BUS_EVENTS.ACCESS_CHANGED, { projectId, userIds: ids })
}

/** A form's responses changed (a submission, a deleted one): its open Responses tab refetches. Ids only. */
export function emitFormResponsesChanged(projectId: string, formId: string) {
  eventBus.emit(BUS_EVENTS.FORM_RESPONSES_CHANGED, { projectId, formId })
}

/**
 * A form's questions/title/settings changed (live co-editing, 19 Oct 2026): the payload (lib/form-coedit-server.ts
 * announceFormChange) goes to `form:<id>`, whose sockets were admitted with Can edit on the project.
 */
export function emitFormOps(projectId: string, formId: string, payload: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.FORM_OPS, { projectId, formId, payload })
}

/** Emit a notification to a specific user's room */
export function emitNotification(userId: string, notification: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.NOTIFICATION, { userId, notification })
}

/** Emit a sprint-updated event to all clients watching a project */
export function emitSprintUpdated(projectId: string, sprint: Record<string, unknown>) {
  eventBus.emit(BUS_EVENTS.SPRINT_UPDATED, { projectId, sprint })
}

/**
 * Emit a chat message to everyone in a conversation room.
 *
 * `memberIds` is the room's roster at send time. With it the socket server re-checks every socket in
 * the room against it, so someone removed from the room after joining it stops receiving messages even
 * if their socket never left (pages/api/socket.ts). Without it (older callers) the room gets it as is.
 */
export function emitMessageCreated(conversationId: string, message: Record<string, unknown>, memberIds?: string[]) {
  eventBus.emit(BUS_EVENTS.MESSAGE_CREATED, { conversationId, message, memberIds })
}

export type ConversationUpdatedPayload = {
  conversationId: string
  /** ISO time of the newest message, or null when the room has none. */
  lastMessageAt: string | null
  /**
   * Why — additive, for clients that want to tell a new message from a read or a mute elsewhere.
   * "deleted" (9 Oct 2026): the group itself is gone (DELETE /api/conversations/:id); sent to every
   * former member with lastMessageAt null, so lists drop it and an open thread closes. A restore from
   * Control Room → Audit brings it back with "membership".
   */
  reason?: "message" | "read" | "mute" | "membership" | "deleted"
}

/** `conversation-updated` to each user's own `user:<id>` room (their other tabs and devices). */
export function emitConversationUpdated(userIds: string[], payload: ConversationUpdatedPayload) {
  if (userIds.length === 0) return
  eventBus.emit(BUS_EVENTS.CONVERSATION_UPDATED, { userIds: Array.from(new Set(userIds)), payload })
}

/** These users are no longer in the conversation: their sockets leave `conversation:<id>` now. */
export function emitConversationMembersRemoved(conversationId: string, userIds: string[]) {
  if (userIds.length === 0) return
  eventBus.emit(BUS_EVENTS.CONVERSATION_MEMBERSHIP, { conversationId, removedUserIds: Array.from(new Set(userIds)) })
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
  originTab?: string | null,
) {
  eventBus.emit(BUS_EVENTS.SHEET_CELLS, { sheetId, rows, actorId, originTab: originTab ?? null })
}

/** Rows added/removed/reordered, or columns changed — the receiver refetches rather than patches. */
export function emitSheetStructure(sheetId: string, actorId: string, originTab?: string | null) {
  eventBus.emit(BUS_EVENTS.SHEET_STRUCTURE, { sheetId, actorId, originTab: originTab ?? null })
}

/**
 * The browser tab that made a sheet write (web header X-Nexus-Tab, 12 Oct 2026). Sheet events carry
 * it so ONLY that tab skips the echo of its own write; the same person's other tabs and devices apply
 * it live (they used to wait for the 20 s poll, bughunt S-BUG-14). Absent on older clients → null,
 * and receivers fall back to skipping by actorId as before.
 */
export function originTabOf(req: { headers: { get(name: string): string | null } }): string | null {
  const v = req.headers.get("x-nexus-tab")
  return v && /^[A-Za-z0-9_-]{6,64}$/.test(v) ? v : null
}

export type WorkspaceChangedKind = "projects" | "folders" | "audit" | "vault" | "submissions" | "legal" | "bookings"

/**
 * `workspace-changed` (owner, 8 Oct 2026): WHICH collection of a workspace moved, never what it now
 * holds. Everyone in the workspace receives it, including people who may not see a given project, so
 * it is only an invalidation ping: the receiver refetches through the normal API, which applies the
 * normal access rules. Ids only, no names, no fields — with one exception: `icon`.
 *
 * `icon` (owner, 14 Oct 2026): set only when a project's icon changed — the new photo URL, or null/"folder"
 * when the photo was removed. Clients patch every cached copy of that project at once (sidebar, cards,
 * header, pickers, search, mentions), before the refetch lands. It is no secret: the photo is served to any
 * signed-in user at /api/files/project-icons/<projectId>.<ext>. Older clients ignore the field.
 */
export type WorkspaceChangedPayload = {
  kind: WorkspaceChangedKind
  projectId?: string
  folderId?: string
  actorId?: string
  icon?: string | null
}

/**
 * Tell every open sidebar, projects page, folder page and project header in `workspaceId` to refetch.
 *
 * Goes to the `workspace:<id>` room, which the socket server puts each socket in by itself on connect
 * from the user's WorkspaceMember rows (pages/api/socket.ts), never by client request. `alsoUserIds`
 * adds those users' own `user:<id>` rooms: for someone the change concerns who may not be in the
 * workspace (a guest added to a project), or for a per-user change such as a pin (workspaceId null).
 *
 * The payload is rebuilt from the allowed fields, so a caller can never put data on the wire by
 * passing a bigger object.
 */
export function emitWorkspaceChanged(
  workspaceId: string | null | undefined,
  payload: WorkspaceChangedPayload,
  alsoUserIds: Array<string | null | undefined> = [],
) {
  const userIds = Array.from(new Set(alsoUserIds.filter((id): id is string => typeof id === "string" && id.length > 0)))
  if (!workspaceId && userIds.length === 0) return
  const ping: WorkspaceChangedPayload = { kind: payload.kind }
  if (payload.projectId) ping.projectId = payload.projectId
  if (payload.folderId) ping.folderId = payload.folderId
  if (payload.actorId) ping.actorId = payload.actorId
  if (payload.icon !== undefined && payload.kind === "projects" && payload.projectId) {
    ping.icon = typeof payload.icon === "string" ? payload.icon.slice(0, 512) : null
  }
  publishSafely(BUS_EVENTS.WORKSPACE_CHANGED, { workspaceId: workspaceId || null, userIds, payload: ping })
}

/**
 * `workspace-changed` { kind: "vault" } (owner, 9 Oct 2026): something a colleague would see change in
 * a Z Vault listing — a file uploaded, a folder made, renamed, moved, trashed, restored, purged, its
 * access changed, a link made. The vault is the company workspace's, so the ping goes to that
 * workspace's room; it carries the actor and nothing else (not even the item: a locked folder's id is
 * not for everyone), and the open vault screens refetch through the API, which applies the access rules.
 */
export function emitVaultChanged(workspaceId: string | null | undefined, actorId?: string) {
  emitWorkspaceChanged(workspaceId, { kind: "vault", actorId })
}

/**
 * `audit-changed` to the `audit` room (only sockets whose user passes resolveAuditAccess are in it).
 * Called after every successful audit write: no database work here, and the socket server folds a
 * burst into one ping, so it costs nothing when nobody has the audit open.
 */
export function emitAuditChanged() {
  publishSafely(BUS_EVENTS.AUDIT_CHANGED, { kind: "audit" })
}

/**
 * `pipeline-changed` { projectId, dealId, actorId } to the `project:<id>` room (owner, 9 Oct 2026): a
 * deal of a Pipeline Dashboard project was created, edited, moved, deleted or restored. A ping, not the
 * deal: whoever has the pipeline open refetches it through GET /api/projects/:id/pipeline, which applies
 * the access rules. Joining that room already needs VIEWER on the project (pages/api/socket.ts), the
 * same bar as reading the pipeline. Apps that do not know the event ignore it. `dealId` null = several.
 */
export function emitPipelineChanged(projectId: string, dealId: string | null, actorId?: string) {
  publishSafely(BUS_EVENTS.PIPELINE_CHANGED, { projectId, dealId, actorId: actorId ?? null })
}

/**
 * `outlet-sales-changed` { projectId, eventId, month, actorId } to the `project:<id>` room (owner, 10 Oct
 * 2026): an event of an Outlet Sales Dashboard project was created, edited, deleted or restored, or a
 * monthly target changed (eventId null). A ping, not the data: whoever has the outlet open refetches the
 * month it shows through GET /api/projects/:id/outlet-sales (whatever `month` says: an event moved to
 * another date can leave one month and enter another). Apps that do not know the event ignore it.
 */
export function emitOutletSalesChanged(projectId: string, eventId: string | null, month: string | null, actorId?: string) {
  publishSafely(BUS_EVENTS.OUTLET_SALES_CHANGED, { projectId, eventId, month, actorId: actorId ?? null })
}

/**
 * `social-media-changed` { projectId, date, month, actorId } to the `project:<id>` room (owner, 14 Oct 2026):
 * a day of a Social Media Report project was recorded, a target or the platforms changed (date null for a
 * monthly target, month null for the platforms). A ping, not the data: whoever has the report open refetches
 * GET /api/projects/:id/social-media for the month it shows. Apps that do not know the event ignore it.
 */
export function emitSocialMediaChanged(projectId: string, date: string | null, month: string | null, actorId?: string) {
  publishSafely(BUS_EVENTS.SOCIAL_MEDIA_CHANGED, { projectId, date, month, actorId: actorId ?? null })
}

/**
 * `automations-changed` { projectId, automationId, actorId } to the `project:<id>` room (12 Oct 2026): a rule
 * was created, edited, toggled, deleted or restored, or it ran (new run-log row). A ping: the open Automations
 * tab refetches through GET /api/automations, which applies the access rules. Apps that do not know it ignore it.
 */
export function emitAutomationsChanged(projectId: string, automationId: string | null, actorId?: string) {
  publishSafely(BUS_EVENTS.AUTOMATIONS_CHANGED, { projectId, automationId, actorId: actorId ?? null })
}

/**
 * These two are called right after a write has succeeded (inside logAudit's try, among others). A
 * listener that throws would otherwise surface there as a failed write: logAudit would return null and
 * a restorable delete would lose the link to its audit row. A ping is never worth that.
 */
/**
 * `gideon-credits` { summary } to `user:<id>` (GIDEON credits, 18 Oct 2026): an answer was billed, or a BoD
 * changed this person's limits / gave a bonus. The summary is the person's own numbers, so it travels in full;
 * the composer meter redraws without a refetch. Apps that do not know the event ignore it.
 */
export function emitGideonCredits(userId: string, summary: unknown) {
  publishSafely(BUS_EVENTS.GIDEON_CREDITS, { userId, summary })
}

/** `reminders-changed` { id } to `user:<id>` (personal reminders, 18 Oct 2026): the Reminders page refetches. */
export function emitRemindersChanged(userId: string, id: string) {
  publishSafely(BUS_EVENTS.REMINDERS_CHANGED, { userId, id })
}

/**
 * `attendance-changed` { kind, id } to each `user:<id>` (QA final 19 Oct 2026, C-17): the person just decided or
 * changed something in attendance, so their other devices refetch the approval queue / board / today card.
 * kind: "request" | "offsite" | "override" | "correction" | "dayoff_bonus" | "dayoff".
 */
export function emitAttendanceChanged(
  userIds: Array<string | null | undefined>,
  kind: string,
  id: string | null,
  /** Additive (19 Oct 2026, lib/attendance-broadcast.ts): whose attendance moved, and which day ("YYYY-MM-DD"). */
  subject?: { userId?: string | null; date?: string | null },
) {
  const ids = [...new Set(userIds.filter((u): u is string => typeof u === "string" && u.length > 0))]
  if (!ids.length) return
  const extra: { userId?: string; date?: string } = {}
  if (subject?.userId) extra.userId = subject.userId
  if (subject?.date) extra.date = subject.date
  publishSafely(BUS_EVENTS.ATTENDANCE_CHANGED, { userIds: ids, kind, id, ...extra })
}

/**
 * `attendance-board-changed` { userIds, dates } to each viewer's `user:<id>` room (19 Oct 2026): the attendance of
 * `userId` moved, and these viewers may see it (lib/attendance-broadcast.ts attendanceViewerIds decides — never call
 * this with a list worked out anywhere else). The socket server folds a burst per viewer into one per second.
 */
export function emitAttendanceBoardChanged(viewerIds: string[], userId: string, date: string | null) {
  const ids = [...new Set(viewerIds.filter((u) => typeof u === "string" && u.length > 0))]
  if (ids.length && userId) publishSafely(BUS_EVENTS.ATTENDANCE_BOARD_CHANGED, { viewerIds: ids, userId, date })
}

/** `xp-changed` { userIds } to `workspace:<id>` rooms (C-D2): open leaderboards refetch. Use lib/xp-realtime.ts noteXpChanged. */
export function emitXpChanged(workspaceIds: string[], userIds: string[]) {
  if (workspaceIds.length && userIds.length) publishSafely(BUS_EVENTS.XP_CHANGED, { workspaceIds, userIds })
}

function publishSafely(event: string, data: unknown) {
  try {
    eventBus.emit(event, data)
  } catch (error) {
    console.warn(`[socket-emitter] ${event} listener failed`, error)
  }
}
