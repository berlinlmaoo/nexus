import { EXTRA_WRITE_ACTIONS, extraNeedsApproval, extraStepLabel, isExtraAction } from "@/lib/gideon-tools/meta"
import { EventEmitter } from "events"
import { parseShimUsage, recordRunUsage } from "@/lib/gideon-credits"
import prisma from "@/lib/prisma"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { createLogger } from "@/lib/logger"
import { bookingChangeView, bookingView, moveNeedsPick, type GideonBookingChangeView, type GideonBookingView } from "@/lib/gideon-book-room-plan"
import { resolveRoomName } from "@/lib/room-booking-rooms"
import { createTaskNeedsProject, type TaskTargetProject } from "@/lib/gideon-task-target"
import { memoryView, type MemoryView } from "@/lib/gideon-memory"
import { gideonSummaryPair, type SummaryLang } from "@/lib/gideon-summary-i18n"
import { changedDiffRows } from "@/lib/gideon-diff-rows"
import { langFromRequest, recipientLang } from "@/lib/notification-text"

/**
 * GIDEON runs (owner, 12 Oct 2026 — "GIDEON replies like Notion's agent").
 *
 * A run is one thing GIDEON did for one person: a chat turn, an @GIDEON mention, a scheduled digest, a
 * support-ticket review or a reflection summary. The run is the thread that ties together everything the
 * chat now shows beside the text:
 *   - steps: each /api/gideon/tools call ("Searching tasks…", "Reading project Atlas");
 *   - sources: the tasks / projects / docs those calls read (citations);
 *   - cards: what it created or changed;
 *   - proposals: writes held for the person's approval (approval mode).
 *
 * How a tool call finds its run: the shim passes the run id to the Hermes plugin (NEXUS_GIDEON_RUN_ID),
 * which sends it back as `x-gideon-run`. A plugin that predates that header still gets its calls
 * counted: the newest RUNNING run of the same actor in the last few minutes is used instead.
 *
 * The live events travel over an in-process bus (the tools route and the chat route run in the same
 * Next server process), and are also written to GideonRunStep / GideonProposal so they survive a reload.
 */

const log = createLogger("gideon-runs")

export type GideonTrigger = "CHAT" | "MENTION" | "SCHEDULE" | "TICKET" | "REFLECTION" | "WRITE" | "AUTOFILL" | "MEETING"
export type ApprovalMode = "always_ask" | "review" | "dont_ask"
export const APPROVAL_MODES: readonly ApprovalMode[] = ["always_ask", "review", "dont_ask"]

export function parseApprovalMode(value: unknown): ApprovalMode | null {
  return typeof value === "string" && (APPROVAL_MODES as readonly string[]).includes(value) ? (value as ApprovalMode) : null
}

/** Tools that change something. Everything else is a read. */
export const WRITE_ACTIONS = new Set(["create_task", "update_task", "add_task_comment", "create_document", "book_room", "move_room_booking", "cancel_room_booking", "delete_task", ...EXTRA_WRITE_ACTIONS])

/**
 * Which writes wait for the person (Notion's "Always ask / Review for me / Skip approvals").
 *  - always_ask: every write.
 *  - review ("Review before writing", the web default): anything that touches other people's work or
 *    attention — editing an existing task, a comment others will read, a task assigned to someone else.
 *    A new task for only the asker, and a new doc, are made directly and shown as a card.
 *    A new task for NOBODY is held too (16 Oct 2026): "turn this doc into tasks for the people named" was
 *    made as tasks for nobody, then assigned by separate update cards. Held, the assignees that follow are
 *    merged into the one create card (tools route, mergeIntoCreateProposal) and Discard leaves nothing.
 *  - dont_ask: nothing waits (what GIDEON did before 12 Oct 2026, and what released apps still get).
 * book_room (16 Oct 2026) waits in always_ask and review; in dont_ask it books directly — unless no single room
 * was named, because GIDEON never guesses a room: the person picks it on the card.
 * move_room_booking / cancel_room_booking (16 Oct 2026) likewise: a card in always_ask and review, direct only in
 * dont_ask — and a move whose named room could be more than one room is a card in every mode.
 * create_task naming no project (owner, 18 Oct 2026): a card with a project picker in EVERY mode.
 * delete_task (owner, 18 Oct 2026): a card in EVERY mode, "don't ask" included. A delete never runs without the
 * person tapping the destructive button on the card (the apply route also wants the task id echoed back from it).
 */
export function needsApproval(mode: ApprovalMode, action: string, input: Record<string, unknown>, actorId: string): boolean {
  if (!WRITE_ACTIONS.has(action)) return false
  if (action === "delete_task") return true
  // A new task with no project named (18 Oct 2026): a card with the project picker in every mode — GIDEON never
  // guesses a project, the person picks it (preselected when the context makes it obvious).
  if (action === "create_task" && createTaskNeedsProject(input)) return true
  // The 18 Oct 2026 package (lib/gideon-tools/meta.ts): "always" = a card in every mode, "modes" = like create_task.
  if (isExtraAction(action)) return extraNeedsApproval(action, mode)
  if (action === "book_room") return mode !== "dont_ask" || !resolveRoomName(input.room).room
  if (action === "move_room_booking") return mode !== "dont_ask" || moveNeedsPick(input)
  if (action === "cancel_room_booking") return mode !== "dont_ask"
  if (mode === "dont_ask") return false
  if (mode === "always_ask") return true
  if (action === "update_task" || action === "add_task_comment") return true
  if (action === "create_task") {
    const ids = Array.isArray(input.assigneeIds) ? input.assigneeIds.filter((x): x is string => typeof x === "string") : []
    return ids.length === 0 || ids.some((id) => id !== actorId)
  }
  return false
}

// ── Shapes sent to the web (and stored in GideonMessage.meta) ─────────────────────────────────────────

/**
 * A source a run read. comment / form / message + excerpt: 12 Oct 2026 (workspace Q&A); older clients draw them
 * as links. booking (a room booking, 16 Oct 2026): the released apps show it as a plain, untappable chip.
 */
export type GideonRef = { kind: "task" | "project" | "doc" | "comment" | "form" | "message" | "booking"; id: string; title: string; projectId?: string | null; url: string; excerpt?: string | null }
export type GideonCard = {
  kind: "task" | "doc" | "comment"
  action: "created" | "updated" | "commented"
  id: string
  title: string
  url: string
  projectName?: string | null
  status?: string | null
  priority?: string | null
  dueDate?: string | null
  assignees?: string[]
}
/** `toDay` / `fromDay`: the "YYYY-MM-DD" behind a Due row's label, for clients that show it in their own language. */
export type GideonDiffRow = { field: string; from?: string | null; to?: string | null; fromDay?: string | null; toDay?: string | null }
export type GideonProposalView = {
  id: string
  action: string
  summary: string
  diff: GideonDiffRow[]
  status: string
  projectId?: string | null
  taskId?: string | null
  createdAt: string
  card?: GideonCard | null
  error?: string | null
  /**
   * book_room only: what the booking card draws (room picker, slot, title). A client without the picker never
   * sees this field and cannot apply the proposal (POST /api/gideon/proposals/:id wants the chosen room).
   */
  booking?: GideonBookingView | null
  /**
   * move_room_booking / cancel_room_booking only (16 Oct 2026): the booking before and after. A client without the
   * card never sees this field and cannot apply the proposal (the apply route wants the booking id back).
   */
  bookingChange?: GideonBookingChangeView | null
  /**
   * delete_task only (18 Oct 2026): the task as it was when the card was made, for the destructive card. A client
   * without that card draws the diff rows; the apply route refuses its Apply without `confirm: { taskId }`.
   */
  taskDelete?: GideonTaskDeleteView | null
  /**
   * create_task without a project (18 Oct 2026): the project picker. `projects` = only those the person can edit;
   * sections and members of the picked one come from GET /api/gideon/task-targets?projectId=. A client without the
   * picker never sees this field and cannot apply the proposal (the apply route wants `task: { projectId, … }`).
   */
  taskTarget?: GideonTaskTargetView | null
  /**
   * The 18 Oct 2026 package only (inbox/chat/reminders/leave/…, lib/gideon-tools/meta.ts): what its card draws beyond
   * the rows — the long text in full (`preview`: a message, a doc section, an announcement) and, once applied, where
   * the result is (`link`). A client without the card draws the diff rows; the apply route refuses its Apply
   * without `confirm: { proposalId }` (released apps), so nothing outward-facing is ever applied from plain rows.
   */
  extra?: GideonExtraView | null
  /**
   * QA final 19 Oct 2026 (E-6): the card summary in both languages. `summary` itself is in the person's language
   * (X-Nexus-Lang / web Accept-Language, else their stored uiLanguage, else English) so released apps that print
   * it as is show it right; new clients pick `summaryId` / `summaryEn` by their own UI language.
   */
  summaryEn?: string
  summaryId?: string
  /**
   * D-10: true when every "before → after" row of the card had before = after (those rows are left out of
   * `diff`): Apply would change nothing. Clients show "No changes · Tidak ada perubahan". Absent = false.
   */
  noChange?: boolean
}
export type GideonTaskTargetView = {
  title: string
  projects: TaskTargetProject[]
  /** Preselected (the project open / @-mentioned, a name the person said, or the only one); null = pick one. */
  projectId: string | null
  taskListId: string | null
  status: string | null
  assigneeIds: string[]
  dueDay: string | null
  /** Once applied: where it went. */
  chosenProjectId: string | null
}
/** `note`: what an applied card adds (e.g. "Skipped: 2 tasks changed by someone meanwhile"). */
export type GideonExtraView = {
  preview: string | null; link: string | null; note: string | null
  /** edit_sheet_cells only: the cells before → after and the rows added, as the card shows them. */
  sheetEdit?: { sheet?: string; project?: string; cells?: { ref: string; from: string | null; to: string | null }[]; newRows?: unknown[] } | null
}
/** What a delete card shows. `deleted`: applied; it can be restored from Control Room → Audit (`auditLogId`). */
export type GideonTaskDeleteView = {
  taskId: string
  title: string
  projectId: string | null
  projectName: string | null
  /** The task's column (its status as the project names it) and the progress word behind it ("To do", "Done"…). */
  status: string | null
  progress: string | null
  due: string | null
  dueDay: string | null
  assignees: string[]
  deleted: boolean
  auditLogId: string | null
}
export type GideonStepView = { id: string; tool: string; arg?: string | null; label: string; status: "running" | "done" | "error"; error?: string | null }
/** memories (19 Oct 2026): what this answer saved or suggested to GIDEON Memory (the Save / Don't save chip). Owner-only. */
export type GideonRunMeta = { steps: GideonStepView[]; sources: GideonRef[]; cards: GideonCard[]; proposals: GideonProposalView[]; memories?: MemoryView[] }

export type RunEvent =
  | { type: "step"; step: GideonStepView }
  | { type: "sources"; sources: GideonRef[] }
  | { type: "card"; card: GideonCard }
  | { type: "proposal"; proposal: GideonProposalView }
  | { type: "memory"; memory: MemoryView }

// ── Bus ───────────────────────────────────────────────────────────────────────────────────────────────
// globalThis, not a module variable: Next bundles each route separately, and the chat route and the tools
// route must share one emitter.
const g = globalThis as unknown as { __gideonRunBus?: EventEmitter }
function bus(): EventEmitter {
  if (!g.__gideonRunBus) {
    g.__gideonRunBus = new EventEmitter()
    g.__gideonRunBus.setMaxListeners(500)
  }
  return g.__gideonRunBus
}
export function publishRunEvent(runId: string, event: RunEvent) {
  bus().emit(`run:${runId}`, event)
}
export function subscribeRun(runId: string, fn: (event: RunEvent) => void): () => void {
  const key = `run:${runId}`
  bus().on(key, fn)
  return () => bus().off(key, fn)
}

/** Control Room › GIDEON › Performance refetches when an answer starts or ends (pages/api/socket.ts folds bursts). */
function perfPing() {
  try { eventBus.emit(BUS_EVENTS.GIDEON_PERF, { kind: "runs" }) } catch { /* never fail an answer over the panel */ }
}

/** The shim runner retried this question with every tool (a router miss): counted on the performance panel. */
export async function markRouterRetry(runId: string | null | undefined) {
  if (!runId) return
  await prisma.gideonRun.update({ where: { id: runId }, data: { routerRetry: true } }).catch(() => {})
}

// ── Run lifecycle ─────────────────────────────────────────────────────────────────────────────────────

export async function startRun(input: {
  userId?: string | null
  trigger: GideonTrigger
  approvalMode?: ApprovalMode
  tier?: string | null
  title?: string | null
  projectId?: string | null
  taskId?: string | null
  scheduleId?: string | null
}): Promise<string | null> {
  try {
    const run = await prisma.gideonRun.create({
      data: {
        userId: input.userId ?? null,
        trigger: input.trigger,
        approvalMode: input.approvalMode ?? "dont_ask",
        tier: input.tier ?? null,
        title: input.title ? input.title.replace(/\s+/g, " ").trim().slice(0, 140) : null,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        scheduleId: input.scheduleId ?? null,
      },
      select: { id: true },
    })
    perfPing()
    return run.id
  } catch (error) {
    // The log is a convenience: never fail the answer because it could not be written.
    log.error("startRun failed", { error: String(error) })
    return null
  }
}

export async function finishRun(runId: string | null | undefined, outcome: { ok: boolean; error?: string | null; replyChars?: number | null; tokens?: number | null; usage?: unknown }) {
  if (!runId) return
  // GIDEON credits (18 Oct 2026): the shim's `usage` for this run, billed to the run's person. Idempotent on
  // runId, so a caller that already billed (the chat route, to stream the new balance) costs nothing here.
  const usage = parseShimUsage(outcome.usage)
  if (usage) await recordRunUsage(runId, usage).catch(() => null)
  try {
    const run = await prisma.gideonRun.findUnique({ where: { id: runId }, select: { startedAt: true } })
    const now = new Date()
    await prisma.gideonRun.update({
      where: { id: runId },
      data: {
        status: outcome.ok ? "SUCCEEDED" : "FAILED",
        error: outcome.ok ? null : (outcome.error || "failed").slice(0, 500),
        replyChars: outcome.replyChars ?? null,
        tokens: outcome.tokens ?? null,
        finishedAt: now,
        durationMs: run ? now.getTime() - run.startedAt.getTime() : null,
      },
    })
    perfPing()
  } catch (error) {
    log.error("finishRun failed", { runId, error: String(error) })
  }
}

/**
 * Which run a tool call belongs to. With the header, the run must exist, be running, be recent and belong
 * to the same actor — a run id is not a credential, but it must not let one person's calls land in
 * another's chat. Without it, the newest running run of the actor (plugins that predate the header).
 */
export async function resolveRunForToolCall(headerRunId: string | null, actorId: string) {
  const since = new Date(Date.now() - 15 * 60 * 1000)
  const select = { id: true, userId: true, approvalMode: true, trigger: true, status: true, startedAt: true, projectId: true } as const
  if (headerRunId) {
    const run = await prisma.gideonRun.findUnique({ where: { id: headerRunId }, select })
    if (run && run.userId === actorId && run.status === "RUNNING" && run.startedAt >= since) return run
    return null
  }
  return prisma.gideonRun.findFirst({
    where: { userId: actorId, status: "RUNNING", startedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    orderBy: { startedAt: "desc" },
    select,
  })
}

// ── Steps ─────────────────────────────────────────────────────────────────────────────────────────────

/** English labels (logs, Insights). The web has the same table, translated, keyed on the tool. */
export function stepLabel(tool: string, arg?: string | null): string {
  const a = arg ? arg.slice(0, 80) : ""
  switch (tool) {
    case "list_projects": return "Listing projects"
    case "list_members": return "Looking up people"
    case "list_tasks": return "Listing tasks"
    case "search_tasks": return a ? `Searching tasks for “${a}”` : "Searching tasks"
    case "search_workspace": return a ? `Searching the workspace for “${a}”` : "Searching the workspace"
    case "get_project_summary": return a ? `Reading project ${a}` : "Reading a project"
    case "list_custom_fields": return "Reading the project's fields"
    case "get_task": return a ? `Reading task ${a}` : "Reading a task"
    case "search_docs": return a ? `Searching docs for “${a}”` : "Searching docs"
    case "get_doc": return a ? `Reading doc ${a}` : "Reading a doc"
    case "create_task": return a ? `Creating task ${a}` : "Creating a task"
    case "update_task": return a ? `Updating task ${a}` : "Updating a task"
    case "add_task_comment": return a ? `Commenting on ${a}` : "Commenting on a task"
    case "create_document": return a ? `Writing doc ${a}` : "Writing a doc"
    case "get_calendar": return a ? `Reading the calendar, ${a}` : "Reading the calendar"
    case "list_room_bookings": return a ? `Checking room bookings, ${a}` : "Checking room bookings"
    case "book_room": return a ? `Booking ${a}` : "Booking a room"
    case "move_room_booking": return a ? `Moving booking ${a}` : "Moving a booking"
    case "cancel_room_booking": return a ? `Cancelling booking ${a}` : "Cancelling a booking"
    case "delete_task": return a ? `Deleting task ${a}` : "Deleting a task"
    case "remember": return "Remembering"
    case "forget": return "Forgetting"
    case "list_my_memories": return "Checking GIDEON Memory"
    default: return extraStepLabel(tool, a) ?? tool.replace(/_/g, " ")
  }
}

/** The human handle for a step: a query, a name, a title — looked up cheaply, never the raw id. */
export async function stepArg(tool: string, input: Record<string, unknown>): Promise<string | null> {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
  try {
    switch (tool) {
      case "search_tasks":
      case "search_docs":
      case "search_workspace":
        return str(input.query)
      case "create_task":
      case "create_document":
        return str(input.title)
      case "get_project_summary":
      case "list_custom_fields": {
        const id = str(input.projectId)
        if (!id) return null
        return (await prisma.project.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
      }
      case "get_task":
      case "update_task":
      case "delete_task":
      case "add_task_comment": {
        const id = str(input.taskId)
        if (!id) return null
        return (await prisma.task.findUnique({ where: { id }, select: { title: true } }))?.title ?? null
      }
      case "get_doc": {
        const id = str(input.docId)
        if (!id) return null
        return (await prisma.doc.findUnique({ where: { id }, select: { title: true } }))?.title ?? null
      }
      case "list_tasks": {
        const id = str(input.projectId)
        if (!id) return null
        return (await prisma.project.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
      }
      case "book_room": {
        const room = resolveRoomName(input.room).room ?? str(input.room)
        return [room ?? "a room", str(input.date) ?? str(input.startsAt)?.slice(0, 10)].filter(Boolean).join(", ")
      }
      case "move_room_booking":
      case "cancel_room_booking": {
        const id = str(input.bookingId) ?? str(input.booking_id)
        if (!id) return null
        return (await prisma.roomBooking.findUnique({ where: { id }, select: { title: true } }))?.title ?? null
      }
      // The days asked about, as typed ("2026-10-19 – 2026-10-25", "Friday"); no lookup.
      case "get_calendar":
      case "list_room_bookings": {
        const from = str(input.from) ?? str(input.date)
        const to = str(input.to)
        const room = tool === "list_room_bookings" ? str(input.room) : null
        const days = from && to && to !== from ? `${from} – ${to}` : from ?? to
        return [room, days].filter(Boolean).join(", ") || null
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

// ── Sources and cards from a tool result ──────────────────────────────────────────────────────────────

type AnyObj = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const taskUrl = (id: string) => `/tasks/${id}`
const projectUrl = (id: string) => `/projects/${id}`
const docUrl = (id: string) => `/docs/${id}`

function taskRef(t: AnyObj): GideonRef | null {
  if (!t || typeof t.id !== "string" || typeof t.title !== "string") return null
  // Full rows carry taskList / project objects; the compact list rows (gideon-compact.ts) carry projectId.
  const projectId = t.taskList?.projectId ?? t.project?.id ?? (typeof t.projectId === "string" ? t.projectId : null)
  return { kind: "task", id: t.id, title: t.title, projectId, url: taskUrl(t.id) }
}

/** What a read touched, capped: a citation list of 40 items is noise. */
export function refsFromResult(tool: string, data: unknown): GideonRef[] {
  const out: GideonRef[] = []
  const push = (r: GideonRef | null) => { if (r && !out.some((x) => x.kind === r.kind && x.id === r.id)) out.push(r) }
  const d = data as AnyObj
  if (!d) return out
  switch (tool) {
    case "list_projects":
      for (const p of (Array.isArray(d) ? d : Array.isArray(d.items) ? d.items : []).slice(0, 8)) if (p?.id && p?.name) push({ kind: "project", id: p.id, title: p.name, url: projectUrl(p.id) })
      break
    case "get_project_summary":
      if (d.project?.id) push({ kind: "project", id: d.project.id, title: d.project.name, url: projectUrl(d.project.id) })
      if (d.project?.id && Array.isArray(d.topOpenTasks)) for (const t of d.topOpenTasks.slice(0, 8)) push(taskRef({ ...t, projectId: d.project.id }))
      break
    case "list_tasks":
    case "search_tasks": {
      // Paged compact rows since 18 Oct 2026 ({ items }); a list in one project names it once at the top.
      const rows = Array.isArray(d) ? d : Array.isArray(d.items) ? d.items : []
      for (const t of rows.slice(0, 10)) push(taskRef(typeof d.projectId === "string" && !t.projectId ? { ...t, projectId: d.projectId } : t))
      break
    }
    case "get_task":
      push(taskRef(d))
      break
    case "search_docs":
      if (Array.isArray(d)) for (const doc of d.slice(0, 8)) if (doc?.id) push({ kind: "doc", id: doc.id, title: doc.title, projectId: doc.projectId ?? null, url: docUrl(doc.id) })
      break
    case "get_doc":
      if (d.id) push({ kind: "doc", id: d.id, title: d.title, projectId: d.projectId ?? null, url: docUrl(d.id) })
      break
    case "search_workspace":
      if (Array.isArray(d.hits)) for (const h of d.hits.slice(0, 12)) if (h?.id && h?.kind) push({ kind: h.kind, id: h.id, title: h.title, projectId: h.projectId ?? null, url: h.url, excerpt: h.excerpt ?? null })
      break
    case "list_room_bookings":
      if (Array.isArray(d.bookings)) for (const b of d.bookings.slice(0, 12)) if (b?.id && b?.title) push({ kind: "booking", id: b.id, title: b.title, url: `/room-booking?booking=${b.id}`, excerpt: `${b.room} · ${b.dayLabel ?? b.day} ${b.start}–${b.end}${b.bookedBy ? ` · ${b.bookedBy}` : ""}` })
      break
    // The booking just made: a "booking" source (no card: released apps would open a card's id as a task).
    case "book_room":
    case "move_room_booking":
      if (d.booking?.id) push({ kind: "booking", id: d.booking.id, title: d.booking.title, url: `/room-booking?booking=${d.booking.id}`, excerpt: `${d.booking.room} · ${d.booking.dayLabel ?? d.booking.day} ${d.booking.start}–${d.booking.end}` })
      break
    // Calendar rows are tasks; a masked row (private project) has no id and never becomes a source.
    case "get_calendar":
      if (Array.isArray(d.items)) for (const t of d.items.filter((x: AnyObj) => x && !x.masked && x.id).slice(0, 12)) push({ kind: "task", id: t.id, title: t.title, projectId: t.projectId ?? null, url: taskUrl(t.id) })
      break
  }
  return out
}

export function cardFromResult(tool: string, data: unknown): GideonCard | null {
  const d = data as AnyObj
  if (!d) return null
  const taskCard = (t: AnyObj, action: GideonCard["action"]): GideonCard | null =>
    t?.id
      ? {
          kind: "task",
          action,
          id: t.id,
          title: t.title,
          url: taskUrl(t.id),
          projectName: t.project?.name ?? t.taskList?.project?.name ?? null,
          status: t.status ?? null,
          priority: t.priority ?? null,
          dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
          assignees: Array.isArray(t.assignees) ? t.assignees.map((a: AnyObj) => a?.name).filter(Boolean) : [],
        }
      : null
  switch (tool) {
    case "create_task": return taskCard(d, "created")
    case "update_task": return taskCard(d, "updated")
    case "add_task_comment": {
      const c = taskCard(d.task, "commented")
      return c ? { ...c, kind: "comment" } : null
    }
    case "create_document":
      return d.id ? { kind: "doc", action: "created", id: d.id, title: d.title, url: docUrl(d.id), projectName: d.project ?? null } : null
    default: return null
  }
}

/** Record one finished tool call and bump the run's counters. Never throws. */
export async function recordStep(runId: string, step: { tool: string; arg?: string | null; ok: boolean; error?: string | null; durationMs: number; refs?: GideonRef[]; card?: GideonCard | null }) {
  try {
    const row = await prisma.gideonRunStep.create({
      data: {
        runId,
        tool: step.tool,
        label: stepLabel(step.tool, step.arg),
        arg: step.arg ? step.arg.slice(0, 200) : null,
        ok: step.ok,
        error: step.error ? step.error.slice(0, 500) : null,
        durationMs: step.durationMs,
        refs: step.refs && step.refs.length ? (step.refs as unknown as object) : undefined,
        card: step.card ? (step.card as unknown as object) : undefined,
      },
      select: { id: true },
    })
    // One statement: concurrent calls of the same run must not lose an increment.
    await prisma.$executeRaw`UPDATE "GideonRun" SET "toolCalls" = "toolCalls" + 1,
      "toolsUsed" = CASE WHEN ${step.tool} = ANY("toolsUsed") THEN "toolsUsed" ELSE array_append("toolsUsed", ${step.tool}) END
      WHERE "id" = ${runId}`
    return row.id
  } catch (error) {
    log.error("recordStep failed", { runId, error: String(error) })
    return null
  }
}

/** The language a proposal's summary is shown in for this person: what this request says, else what they chose. */
export async function proposalLang(userId: string, headers?: Headers | null): Promise<SummaryLang> {
  const asked = headers ? langFromRequest(headers) : null
  if (asked) return asked
  return (await recipientLang(userId).catch(() => null)) === "id" ? "id" : "en"
}

export function proposalView(p: { id: string; action: string; summary: string; diff: unknown; status: string; projectId: string | null; taskId: string | null; createdAt: Date; result?: unknown; error?: string | null; input?: unknown }, lang?: SummaryLang): GideonProposalView {
  const result = p.result as AnyObj | null | undefined
  // `lang` is typed, but `.map(proposalView)` would pass the index: anything but "id" is English.
  const pair = gideonSummaryPair(p.summary)
  const { rows, noChange } = changedDiffRows(Array.isArray(p.diff) ? (p.diff as GideonDiffRow[]) : [])
  return {
    id: p.id,
    action: p.action,
    summary: lang === "id" ? pair.summaryId : p.summary,
    ...pair,
    ...(noChange ? { noChange: true } : {}),
    diff: rows,
    status: p.status,
    projectId: p.projectId,
    taskId: p.taskId,
    createdAt: p.createdAt.toISOString(),
    card: result && typeof result === "object" && "card" in result ? (result.card as GideonCard) : null,
    error: p.error ?? null,
    ...(p.action === "book_room" ? { booking: bookingView(p.input, (result?.booking as AnyObj | undefined)?.id ?? null) } : {}),
    ...(p.action === "move_room_booking" || p.action === "cancel_room_booking" ? { bookingChange: bookingChangeView(p.action, p.input, result) } : {}),
    ...(p.action === "delete_task" ? { taskDelete: taskDeleteView(p.input, result, p.status) } : {}),
    ...(p.action === "create_task" && (p.input as AnyObj | null)?.pickProject === true ? { taskTarget: taskTargetView(p.input) } : {}),
    ...(isExtraAction(p.action) ? { extra: extraView(p.input, result) } : {}),
  }
}

function extraView(input: unknown, result: AnyObj | null | undefined): GideonExtraView {
  const i = (input && typeof input === "object" ? input : {}) as AnyObj
  return {
    preview: typeof i.preview === "string" && i.preview ? i.preview : null,
    link: typeof result?.link === "string" && result.link ? result.link : null,
    note: typeof result?.note === "string" && result.note ? result.note : null,
    ...(i.sheetEdit && typeof i.sheetEdit === "object" ? { sheetEdit: i.sheetEdit as GideonExtraView["sheetEdit"] } : {}),
  }
}

/** The create card's project picker, from what the proposal stored when it was made (tools route describeWrite). */
export function taskTargetView(input: unknown): GideonTaskTargetView | null {
  const i = (input && typeof input === "object" ? input : {}) as AnyObj
  const t = (i.taskTarget && typeof i.taskTarget === "object" ? i.taskTarget : null) as AnyObj | null
  if (!t) return null
  const s = (v: unknown) => (typeof v === "string" && v ? v : null)
  const due = s(i.dueDate)
  return {
    title: s(i.title) ?? "",
    projects: Array.isArray(t.projects) ? (t.projects as TaskTargetProject[]) : [],
    projectId: s(t.preselectedProjectId),
    taskListId: s(i.taskListId),
    status: s(i.status),
    assigneeIds: Array.isArray(i.assigneeIds) ? i.assigneeIds.filter((x: unknown): x is string => typeof x === "string") : [],
    dueDay: s(t.dueDay) ?? (due && /^\d{4}-\d{2}-\d{2}/.test(due) ? due.slice(0, 10) : null),
    chosenProjectId: s(i.projectId),
  }
}

/** The delete card's task, from the snapshot the proposal stored when it was made (tools route describeWrite). */
export function taskDeleteView(input: unknown, result: AnyObj | null | undefined, status: string): GideonTaskDeleteView | null {
  const i = (input && typeof input === "object" ? input : {}) as AnyObj
  const b = (i.before && typeof i.before === "object" ? i.before : null) as AnyObj | null
  const taskId = typeof i.taskId === "string" ? i.taskId : null
  if (!b || !taskId) return null
  const s = (v: unknown) => (typeof v === "string" && v ? v : null)
  return {
    taskId,
    title: s(b.title) ?? "",
    projectId: s(b.projectId),
    projectName: s(b.projectName),
    status: s(b.status),
    progress: s(b.progress),
    due: s(b.due),
    dueDay: s(b.dueDay),
    assignees: Array.isArray(b.assignees) ? b.assignees.filter((x: unknown): x is string => typeof x === "string") : [],
    deleted: status === "APPLIED",
    auditLogId: s(result?.auditLogId),
  }
}

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

/**
 * The sources an answer actually cites (audit 12 Oct 2026): named in the reply by its title (first 60
 * characters, at least 3) or by its id. Everything else a tool merely read is left off the Sources row.
 * The web has the same rule (apps/web/src/lib/gideon-cite.ts citedSources).
 */
export function citedRefs(reply: string, refs: GideonRef[]): GideonRef[] {
  const said = normText(reply || "")
  if (!said) return []
  const out: GideonRef[] = []
  for (const r of refs) {
    if (!r || out.some((x) => x.kind === r.kind && x.id === r.id)) continue
    const title = normText(r.title || "").slice(0, 60)
    if ((r.id && reply.includes(r.id)) || (title.length >= 3 && said.includes(title))) out.push(r)
  }
  return out
}

/**
 * Everything a run showed, rebuilt from the tables — stored on the assistant turn for the history.
 * `citedBy` (the reply): keep only the sources it cites (citedRefs), before the cap of 20.
 */
export async function runMeta(runId: string, opts: { citedBy?: string } = {}): Promise<GideonRunMeta> {
  const [steps, proposals, memories] = await Promise.all([
    prisma.gideonRunStep.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
    prisma.gideonProposal.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
    prisma.gideonMemory.findMany({ where: { sourceRunId: runId }, orderBy: { createdAt: "asc" } }).catch(() => []),
  ])
  const sources: GideonRef[] = []
  const cards: GideonCard[] = []
  for (const s of steps) {
    for (const r of (Array.isArray(s.refs) ? (s.refs as unknown as GideonRef[]) : [])) {
      if (!sources.some((x) => x.kind === r.kind && x.id === r.id)) sources.push(r)
    }
    if (s.card) cards.push(s.card as unknown as GideonCard)
  }
  return {
    steps: steps.map((s) => ({ id: s.id, tool: s.tool, arg: s.arg, label: s.label, status: s.ok === false ? "error" : "done", error: s.error })),
    sources: (opts.citedBy !== undefined ? citedRefs(opts.citedBy, sources) : sources).slice(0, 20),
    cards,
    proposals: proposals.map((p) => proposalView(p)),
    ...(memories.length ? { memories: memories.map(memoryView) } : {}),
  }
}

/**
 * Short text for prompts: tell the model what its approval mode means, so it reports honestly, and how to
 * make a task in ONE call (the server holds and merges anyway, see needsApproval).
 */
export function approvalPromptLine(mode: ApprovalMode, lang: "id" | "en" = "id"): string {
  if (mode === "dont_ask") return ""
  return lang === "en"
    ? "[APPROVAL] Some writes are held for the person's approval. When a NEXUS tool answers with proposed:true, the change has NOT happened yet: say it is waiting for their approval in the card below, never that it is done. " +
      "A new task is ONE nexus_create_task call with everything in it — title, section/status, dueDate and assigneeIds of the people named — never a create followed by an update to assign it or date it."
    : "[PERSETUJUAN] Sebagian perubahan ditahan sampai orangnya menyetujui. Kalau tool NEXUS menjawab proposed:true, perubahannya BELUM terjadi: bilang perubahan itu menunggu persetujuannya di kartu di bawah, jangan bilang sudah selesai. " +
      "Task baru = SATU panggilan nexus_create_task yang sudah lengkap — judul, section/status, dueDate, dan assigneeIds orang yang disebut — jangan bikin dulu lalu update untuk meng-assign atau memberi tenggat."
}
