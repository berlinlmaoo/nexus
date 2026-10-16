import { EventEmitter } from "events"
import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { bookingView, type GideonBookingView } from "@/lib/gideon-book-room-plan"
import { resolveRoomName } from "@/lib/room-booking-rooms"

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

export type GideonTrigger = "CHAT" | "MENTION" | "SCHEDULE" | "TICKET" | "REFLECTION" | "WRITE" | "AUTOFILL"
export type ApprovalMode = "always_ask" | "review" | "dont_ask"
export const APPROVAL_MODES: readonly ApprovalMode[] = ["always_ask", "review", "dont_ask"]

export function parseApprovalMode(value: unknown): ApprovalMode | null {
  return typeof value === "string" && (APPROVAL_MODES as readonly string[]).includes(value) ? (value as ApprovalMode) : null
}

/** Tools that change something. Everything else is a read. */
export const WRITE_ACTIONS = new Set(["create_task", "update_task", "add_task_comment", "create_document", "book_room"])

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
 */
export function needsApproval(mode: ApprovalMode, action: string, input: Record<string, unknown>, actorId: string): boolean {
  if (!WRITE_ACTIONS.has(action)) return false
  if (action === "book_room") return mode !== "dont_ask" || !resolveRoomName(input.room).room
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
}
export type GideonStepView = { id: string; tool: string; arg?: string | null; label: string; status: "running" | "done" | "error"; error?: string | null }
export type GideonRunMeta = { steps: GideonStepView[]; sources: GideonRef[]; cards: GideonCard[]; proposals: GideonProposalView[] }

export type RunEvent =
  | { type: "step"; step: GideonStepView }
  | { type: "sources"; sources: GideonRef[] }
  | { type: "card"; card: GideonCard }
  | { type: "proposal"; proposal: GideonProposalView }

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
    return run.id
  } catch (error) {
    // The log is a convenience: never fail the answer because it could not be written.
    log.error("startRun failed", { error: String(error) })
    return null
  }
}

export async function finishRun(runId: string | null | undefined, outcome: { ok: boolean; error?: string | null; replyChars?: number | null; tokens?: number | null }) {
  if (!runId) return
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
    default: return tool.replace(/_/g, " ")
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
  const projectId = t.taskList?.projectId ?? t.project?.id ?? null
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
      if (Array.isArray(d)) for (const p of d.slice(0, 8)) if (p?.id && p?.name) push({ kind: "project", id: p.id, title: p.name, url: projectUrl(p.id) })
      break
    case "get_project_summary":
      if (d.project?.id) push({ kind: "project", id: d.project.id, title: d.project.name, url: projectUrl(d.project.id) })
      break
    case "list_tasks":
    case "search_tasks":
      if (Array.isArray(d)) for (const t of d.slice(0, 10)) push(taskRef(t))
      break
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

export function proposalView(p: { id: string; action: string; summary: string; diff: unknown; status: string; projectId: string | null; taskId: string | null; createdAt: Date; result?: unknown; error?: string | null; input?: unknown }): GideonProposalView {
  const result = p.result as AnyObj | null | undefined
  return {
    id: p.id,
    action: p.action,
    summary: p.summary,
    diff: Array.isArray(p.diff) ? (p.diff as GideonDiffRow[]) : [],
    status: p.status,
    projectId: p.projectId,
    taskId: p.taskId,
    createdAt: p.createdAt.toISOString(),
    card: result && typeof result === "object" && "card" in result ? (result.card as GideonCard) : null,
    error: p.error ?? null,
    ...(p.action === "book_room" ? { booking: bookingView(p.input, (result?.booking as AnyObj | undefined)?.id ?? null) } : {}),
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
  const [steps, proposals] = await Promise.all([
    prisma.gideonRunStep.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
    prisma.gideonProposal.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
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
    proposals: proposals.map(proposalView),
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
