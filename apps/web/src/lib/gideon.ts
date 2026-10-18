// Streaming client for the Gideon AI assistant (POST /api/gideon, SSE response).
// Since 12 Oct 2026 the web asks for the streaming contract (`stream: true`): `run`, `delta` pieces of
// text, `reset` (a tool round started; drop the interim text), `step` (tool progress), `sources`
// (what it read), `card` (what it created/changed), `proposal` (a write waiting for approval), `final`
// (the authoritative answer), `error`, `done`. Released iOS/Android keep the old one: `text` + `done`.
import { useSyncExternalStore } from "react";
import { getLang } from "@/lib/lang";
import { ApiError } from "@/lib/nexus-api";

/** GIDEON tiers. Display names are GIDEON's own (owner, 18 Oct 2026: not GPT's); the ids stay for older apps. Which
 *  model each one runs is decided in the shim (astra = Artemis, luna = Phaëthon, the default, terra = Aphrodite). */
export const GIDEON_TIERS = [
  { id: "astra", name: "Artemis", blurb: "Deepest. For analysis and decisions." },
  { id: "luna", name: "Phaëthon", blurb: "Everyday work." },
  { id: "terra", name: "Aphrodite", blurb: "Light. Short questions." },
  // Runs on the RTX 5070 in the office, not on anybody's API. Measurably weaker than the hosted
  // tiers — it got a task count wrong that Luna got right — so the label says experimental and
  // means it.
  { id: "experimental", name: "Model 0", blurb: "Local model in the office. Slow and can be wrong." },
] as const;

export type GideonTier = (typeof GIDEON_TIERS)[number]["id"];
export const GIDEON_DEFAULT_TIER: GideonTier = "luna";

export type GideonMessage = { role: "user" | "assistant"; content: string };

/**
 * A file a question carried, as the server kept it. The authority on this shape is
 * StoredGideonAttachment in the Next app's src/lib/gideon-attachments.ts; this is a copy of it and
 * must not drift.
 *
 * `url` is a PATH and never a full URL — /api/files/attachments/gideon/<uuid>.<ext>. That endpoint
 * wants a session, and a browser attaches its cookie to a same-origin request by itself, so the
 * path works unchanged in an `<img src>` and in a link with nothing else done to it.
 *
 * The chip for a turn sent in THIS session puts a blob: url here instead — same shape, different
 * handle, because those bytes exist in the tab before they exist anywhere the browser can fetch.
 */
export type GideonAttachment = {
  kind: "image" | "document";
  url: string;
  /** The name the file had when it was picked. Empty for a photo, which never had one. */
  name: string;
  /** A hint for how to open it. /api/files sets the real Content-Type from the extension. */
  mime: string;
  size: number;
};

// ── What a run shows beside the text (mirrors src/lib/gideon-runs.ts on the server) ─────────────────
export type GideonRef = { kind: "task" | "project" | "doc" | "comment" | "form" | "message" | "booking"; id: string; title: string; projectId?: string | null; url: string; excerpt?: string | null };
export type GideonCard = {
  kind: "task" | "doc" | "comment";
  action: "created" | "updated" | "commented";
  id: string;
  title: string;
  url: string;
  projectName?: string | null;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  assignees?: string[];
};
export type GideonDiffRow = { field: string; from?: string | null; to?: string | null; fromDay?: string | null; toDay?: string | null };
export type GideonProposal = {
  id: string;
  action: "create_task" | "update_task" | "add_task_comment" | "create_document" | string;
  summary: string;
  diff: GideonDiffRow[];
  status: "PENDING" | "APPLYING" | "APPLIED" | "DISCARDED" | "FAILED" | string;
  projectId?: string | null;
  taskId?: string | null;
  createdAt: string;
  card?: GideonCard | null;
  error?: string | null;
  /** book_room only (16 Oct 2026): what the booking card draws; the rooms' availability is read live. */
  booking?: GideonBookingView | null;
  /** move_room_booking / cancel_room_booking only (16 Oct 2026): the booking before and after. */
  bookingChange?: GideonBookingChangeView | null;
  /** delete_task only (18 Oct 2026): the task as the card shows it; `deleted` once applied (restorable from the Audit). */
  taskDelete?: GideonTaskDeleteView | null;
  /** create_task without a project (18 Oct 2026): the project picker (projects the person can edit). */
  taskTarget?: GideonTaskTargetView | null;
  /**
   * The 18 Oct 2026 package only (send_message, create_reminder, submit_leave_request, …): the long text in full and,
   * once applied, where the result is. Present (even null) only on those actions; their card is GideonActionCard.
   */
  extra?: { preview: string | null; link: string | null; note?: string | null; sheetEdit?: { sheet?: string; project?: string; cells?: { ref: string; from: string | null; to: string | null }[]; newRows?: unknown[] } | null } | null;
};
export type GideonTaskTargetProject = { id: string; name: string; icon: string | null; color: string | null };
/** Server gideon-runs.ts GideonTaskTargetView. */
export type GideonTaskTargetView = {
  title: string;
  projects: GideonTaskTargetProject[];
  projectId: string | null;
  taskListId: string | null;
  status: string | null;
  assigneeIds: string[];
  dueDay: string | null;
  chosenProjectId: string | null;
};
export type GideonTaskTargetOptions = {
  sections: { id: string; name: string; taskStatus: string | null; color: string | null }[];
  members: { id: string; name: string; avatar: string | null }[];
};
/** The picked project's columns and members (PIC = project members only). 403 = can't add tasks there. */
export const gideonTaskTargetOptions = (projectId: string) => gjson<GideonTaskTargetOptions>(`/api/gideon/task-targets?projectId=${encodeURIComponent(projectId)}`);
export type GideonTaskChoice = { projectId: string; taskListId?: string | null; assigneeIds: string[]; dueDate: string | null };
/** Server gideon-runs.ts GideonTaskDeleteView. */
export type GideonTaskDeleteView = {
  taskId: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  status: string | null;
  progress: string | null;
  due: string | null;
  dueDay: string | null;
  assignees: string[];
  deleted: boolean;
  auditLogId: string | null;
};
type GideonBookingSlot = { room: string; day: string; dayLabel: string; start: string; end: string; startsAt: string; endsAt: string };
/** Server gideon-book-room-plan.ts GideonBookingChangeView. A move's `after.room` is null when it is picked on the card. */
export type GideonBookingChangeView = {
  kind: "move" | "cancel";
  bookingId: string;
  title: string;
  bookedBy: string | null;
  before: GideonBookingSlot;
  after: (Omit<GideonBookingSlot, "room"> & { room: string | null; requestedRoom: string | null; candidates: string[] }) | null;
  applied?: GideonBookingSlot | null;
};
/** Server gideon-book-room-plan.ts GideonBookingView. Times are ISO instants; day is the WIB day. */
export type GideonBookingView = {
  title: string;
  day: string;
  dayLabel: string;
  start: string;
  end: string;
  startsAt: string;
  endsAt: string;
  room: string | null;
  requestedRoom: string | null;
  candidates: string[];
  bookingId?: string | null;
};
/** GET /api/room-bookings/availability: every room for one slot, and the nearest free slots when none is free. */
export type RoomAvailability = {
  rooms: { room: string; free: boolean; busy: { id: string; title: string; by: string | null; startsAt: string; endsAt: string } | null }[];
  freeSlots: { startsAt: string; endsAt: string; rooms: string[] }[];
};
export type GideonStep = { id: string; tool: string; arg?: string | null; label: string; status: "running" | "done" | "error"; error?: string | null };
export type GideonRunMeta = { steps: GideonStep[]; sources: GideonRef[]; cards: GideonCard[]; proposals: GideonProposal[] };

/** History sends `attachments` on every message, always an array, empty where nothing was attached. */
export type GideonTurn = GideonMessage & { tools?: string[]; attachments?: GideonAttachment[]; runId?: string | null; meta?: GideonRunMeta | null };

export type GideonEvent =
  | { type: "text"; content: string }
  | { type: "tool_result"; content?: unknown; name?: string }
  | { type: "run"; id: string }
  | { type: "chat"; id: string; title?: string | null }
  | { type: "delta"; content: string }
  | { type: "reset" }
  | { type: "final"; content: string }
  | { type: "step"; step: GideonStep }
  | { type: "sources"; sources: GideonRef[] }
  /** Sent once before `final`: the sources the answer actually cites. Replaces the `sources` collected so far. */
  | { type: "cited"; sources: GideonRef[] }
  | { type: "card"; card: GideonCard }
  | { type: "proposal"; proposal: GideonProposal }
  | { type: "done" }
  /** GIDEON credits (18 Oct 2026): the person's balance after this answer; `notice` when phase 2 changed the tier or refused. */
  | { type: "credits"; summary?: import("@/lib/gideon-credits").CreditSummary | null; credits?: number; notice?: import("@/lib/gideon-credits").CreditNotice }
  | { type: "error"; content?: string; code?: string }
  /** The chosen tier can't answer now (Model 0 lends the GPU to a meeting transcript, 18 Oct 2026). An `error` follows. */
  | { type: "tier_unavailable"; tier: string; reason: string | null; fallback: string };

/** Which writes wait for the person. Same names as the server (gideon-runs.ts needsApproval). */
export const GIDEON_APPROVAL_MODES = [
  { id: "always_ask", name: "Always ask", blurb: "Every change GIDEON wants to make waits for you." },
  { id: "review", name: "Review before writing", blurb: "Edits, comments and tasks for other people wait for you. Your own new tasks and docs are made directly." },
  { id: "dont_ask", name: "Don't ask", blurb: "GIDEON makes changes right away, as you." },
] as const;
export type GideonApprovalMode = (typeof GIDEON_APPROVAL_MODES)[number]["id"];
export const GIDEON_DEFAULT_APPROVAL: GideonApprovalMode = "review";

/** Where GIDEON was opened from. The server checks access and ignores what the person cannot see. */
export type GideonContext = { projectId: string; projectName: string; taskId?: string; taskTitle?: string; docId?: string; docTitle?: string };
/** A page @-mentioned in the composer (or the page GIDEON was opened from): sent as context.refs. */
export type GideonContextRef = { kind: "project" | "task" | "doc"; id: string; title: string };

/**
 * A document attachment — PDF, Office, or plain text. Separate from an image, and both may ride in
 * the same request. `data` is a data URL or bare base64; the route accepts either.
 */
export type GideonFile = {
  /** Filename WITH extension, e.g. "invoice-agustus.pdf". This is what the route reads the type off. */
  name: string;
  /** MIME type from the picker. Only consulted when `name` has no usable extension. */
  type: string;
  /** A data URL or bare base64 of the file's bytes. */
  data: string;
};

/**
 * Extensions the route accepts. Mirrors DOC_EXTENSIONS in /api/gideon, which refuses anything else
 * with a 415: Hermes reaches a document through a converter, and a type that converter cannot decode
 * arrives as bytes the model will confidently describe without having read.
 * The server stays the authority — this copy only ever prevents an upload, never permits one.
 */
export const GIDEON_FILE_EXTENSIONS: readonly string[] = [
  "pdf",
  "txt", "md", "csv", "tsv", "json", "log", "yml", "yaml", "xml", "html",
  "docx", "doc", "xlsx", "xls", "pptx", "ppt",
  "odt", "ods", "odp", "rtf", "epub", "ipynb",
];

/** The route's own limit. Checked here too, so a 10 MB upload is not sent to be told it was too big. */
export const GIDEON_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** For a file input's `accept` attribute — a hint to the picker, not the check. */
export const GIDEON_FILE_ACCEPT = GIDEON_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");

/**
 * Whether a picked file is one GIDEON can read.
 *
 * Judged from the filename alone, unlike the route, which falls back to the MIME type when the name
 * has no extension: that fallback exists for iOS document providers, and a file handed over by a
 * browser file input always carries the name it had on disk.
 */
export function isAcceptedGideonFile(name: string): boolean {
  const ext = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  return Boolean(ext && GIDEON_FILE_EXTENSIONS.includes(ext));
}

/**
 * Where an attachment chip points, and whether what it finds there should be saved.
 *
 * /api/files has already made this decision once — it serves a known-safe type inline and forces a
 * download for everything else — so this only has to agree with it, and the set below is a subset
 * of that route's INLINE_OK. What a tab can usefully show is the picture and the PDF. A .docx or a
 * spreadsheet can only be saved, and `?download=` is the route's own way of being told to save it
 * under the name the user picked rather than the uuid it is stored as.
 *
 * A blob: url is a handle this tab holds rather than a request it makes, so it takes the name as an
 * attribute instead: a query string appended to one names nothing and breaks the handle.
 */
export function gideonAttachmentLink(a: GideonAttachment): { href: string; download?: string } {
  const inline = a.kind === "image" || a.mime === "application/pdf" || /\.pdf$/i.test(a.url);
  if (inline) return { href: a.url };
  const name = a.name.trim();
  if (!a.url.startsWith("/")) return name ? { href: a.url, download: name } : { href: a.url };
  // Both, the way every other download link in this app does it: the query is what makes the
  // RESPONSE carry the name, the attribute is what the browser falls back on. The stored basename
  // is a uuid but it does at least end in the right extension, so it beats "file".
  const saveAs = name || a.url.split("/").pop() || "file";
  return { href: `${a.url}?download=${encodeURIComponent(saveAs)}`, download: saveAs };
}

export async function streamGideon(
  messages: GideonMessage[],
  onEvent: (event: GideonEvent) => void,
  opts: { model?: string; signal?: AbortSignal; image?: string | null; file?: GideonFile | null; approvalMode?: GideonApprovalMode; context?: GideonContext | null; refs?: GideonContextRef[]; chatId?: string | null; newChat?: boolean } = {},
): Promise<void> {
  const res = await fetch("/api/gideon", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      messages,
      model: opts.model ?? GIDEON_DEFAULT_TIER,
      stream: true,
      // The interface language, so the answer comes back in it (12 Oct 2026; older servers ignore it).
      uiLang: getLang(),
      approvalMode: opts.approvalMode ?? GIDEON_DEFAULT_APPROVAL,
      ...(opts.context || opts.refs?.length
        ? { context: {
            ...(opts.context?.projectId ? { projectId: opts.context.projectId } : {}),
            ...(opts.context?.taskId ? { taskId: opts.context.taskId } : {}),
            ...(opts.context?.docId ? { docId: opts.context.docId } : {}),
            ...(opts.refs?.length ? { refs: opts.refs.map((r) => ({ kind: r.kind, id: r.id })) } : {}),
          } }
        : {}),
      ...(opts.chatId ? { chatId: opts.chatId } : opts.newChat ? { newChat: true } : {}),
      ...(opts.image ? { image: opts.image } : {}),
      ...(opts.file ? { file: opts.file } : {}),
    }),
    signal: opts.signal,
  });

  // A refused attachment arrives as plain JSON with a real HTTP status BEFORE any stream exists, so
  // the status is settled before a byte of SSE is parsed. The route writes its own sentence for a
  // 415 or a 413 — which file, and what to do about it — and replacing that with "Request failed"
  // would throw away the only half that helps.
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body?.error === "string" && body.error.trim()) message = body.error.trim();
    } catch {
      // Not JSON — a gateway page, or a body already consumed. The status is all there is to say.
    }
    onEvent({ type: "error", content: message });
    return;
  }

  if (!res.body) {
    onEvent({ type: "error", content: `Request failed (${res.status})` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json) as GideonEvent);
      } catch {
        // ignore malformed frame
      }
    }
  }
}

// Chat history is stored server-side per user (GET/DELETE /api/gideon/history), so a conversation
// survives closing the panel, a refresh, and switching devices.
export async function loadGideonHistory(chatId?: string | null, onChat?: (chat: { id: string; title: string | null } | null) => void): Promise<GideonTurn[]> {
  try {
    const res = await fetch(`/api/gideon/history${chatId ? `?chatId=${encodeURIComponent(chatId)}` : ""}`, { credentials: "include", headers: { Accept: "application/json" } });
    // A named conversation that can't be loaded is an error the page shows (QA 13 Oct 2026: it opened as an
    // empty "new chat", hiding that it failed). The latest-chat load (no id) still falls back to empty.
    if (!res.ok) { if (chatId) throw new ApiError(res.status, `history ${res.status}`, null); return []; }
    const data = (await res.json()) as { messages?: GideonTurn[]; chat?: { id: string; title: string | null } | null };
    onChat?.(data.chat ?? null);
    if (!Array.isArray(data.messages)) return [];
    // The route promises an array here on every message and sanitises each entry before sending it,
    // so this is not re-validation — it is the one thing the renderer would crash on if a build of
    // the server that predates the promise is ever what answers.
    return data.messages.map((row) => ({ ...row, attachments: Array.isArray(row?.attachments) ? row.attachments : [], meta: row?.meta && typeof row.meta === "object" ? row.meta : null }));
  } catch (e) {
    // An unreachable history endpoint must not block a fresh chat; a named one says it failed.
    if (chatId) throw e;
    return [];
  }
}

export async function clearGideonHistory(): Promise<boolean> {
  try {
    const res = await fetch("/api/gideon/history", { method: "DELETE", credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Proposals (approval mode) ──────────────────────────────────────────────────────────────────────────

async function gjson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", "X-Nexus-Client": "web/1", ...(init?.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

/** `excludeBookingId`: the booking a move card is moving (its own slot is not "taken" by itself). */
export const roomAvailability = (startsAt: string, endsAt: string, excludeBookingId?: string) =>
  gjson<RoomAvailability>(`/api/room-bookings/availability?startsAt=${encodeURIComponent(startsAt)}&endsAt=${encodeURIComponent(endsAt)}${excludeBookingId ? `&excludeBookingId=${encodeURIComponent(excludeBookingId)}` : ""}`);

export const pendingGideonProposals = () => gjson<{ proposals: GideonProposal[] }>("/api/gideon/proposals");

/**
 * Apply or discard. A 409/410/422 still carries the proposal's new state, which is returned. `booking`: the room
 * and slot picked on a book_room card (required to apply one); on a move card the same plus `bookingId`, on a
 * cancel card `{ bookingId }` alone (required to apply those).
 */
export async function decideGideonProposal(id: string, decision: "apply" | "discard", booking?: { bookingId?: string; room?: string; startsAt?: string; endsAt?: string }, extra?: { confirm?: { taskId?: string; proposalId?: string }; task?: GideonTaskChoice }): Promise<GideonProposal> {
  try {
    // `confirm`: a delete_task card sends the task id back; `task`: a create card's picked project, column, PIC, due
    // (each required to apply that kind).
    const r = await gjson<{ proposal: GideonProposal }>(`/api/gideon/proposals/${id}`, { method: "POST", body: JSON.stringify({ decision, ...(booking ? { booking } : {}), ...(extra?.confirm ? { confirm: extra.confirm } : {}), ...(extra?.task ? { task: extra.task } : {}) }) });
    return r.proposal;
  } catch (e) {
    const p = (e as { body?: { proposal?: GideonProposal } }).body?.proposal;
    if (p) return p;
    throw e;
  }
}

// ── Schedules and runs (triggers, Insights) ────────────────────────────────────────────────────────────

export type GideonSchedule = {
  id: string;
  projectId: string;
  kind: string;
  enabled: boolean;
  weekdays: number[];
  time: string;
  timezone: string;
  language: "id" | "en" | string;
  instructions: string | null;
  runsAs: { id: string; name: string | null } | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
};
export type GideonRunRow = {
  id: string;
  trigger: "CHAT" | "MENTION" | "SCHEDULE" | "TICKET" | "REFLECTION" | string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | string;
  approvalMode: string;
  tier: string | null;
  title: string | null;
  titleHidden: boolean;
  user: { id: string; name: string | null; avatar: string | null } | null;
  projectId: string | null;
  taskId: string | null;
  scheduleId: string | null;
  toolsUsed: string[];
  toolCalls: number;
  tokens: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};
export type GideonRunTotals = { days: number; runs: number; failures: number; completionRate: number | null; activeUsers: number };

export const gideonSchedules = (projectId: string) =>
  gjson<{ schedules: GideonSchedule[]; canManage: boolean; configured: boolean }>(`/api/gideon/schedules?projectId=${encodeURIComponent(projectId)}`);
export const createGideonSchedule = (body: Partial<GideonSchedule> & { projectId: string }) =>
  gjson<{ schedule: GideonSchedule }>("/api/gideon/schedules", { method: "POST", body: JSON.stringify(body) });
export const updateGideonSchedule = (id: string, body: Partial<GideonSchedule>) =>
  gjson<{ schedule: GideonSchedule }>(`/api/gideon/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteGideonSchedule = (id: string) => gjson<{ ok: boolean }>(`/api/gideon/schedules/${id}`, { method: "DELETE" });
export const runGideonScheduleNow = (id: string) => gjson<{ started: boolean }>(`/api/gideon/schedules/${id}/run`, { method: "POST" });

export function gideonRuns(q: { projectId?: string; trigger?: string; status?: string; before?: string; limit?: number } = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") sp.set(k, String(v));
  return gjson<{ runs: GideonRunRow[]; totals: GideonRunTotals }>(`/api/gideon/runs${sp.size ? `?${sp}` : ""}`);
}
export const gideonRunDetail = (id: string) =>
  gjson<{ run: GideonRunRow; steps: { id: string; tool: string; label: string; ok: boolean | null; error: string | null; durationMs: number | null; at: string }[]; stepsHidden: boolean }>(`/api/gideon/runs/${id}`);

// ── Opening the panel from anywhere (project header "Ask GIDEON") ──────────────────────────────────────

/** `chatId`: open that conversation; `newChat`: start a fresh one (⌘/Ctrl+O); neither: the latest one. */
type LauncherState = { open: boolean; context: GideonContext | null; nonce: number; chatId?: string | null; newChat?: boolean };
let launcher: LauncherState = { open: false, context: null, nonce: 0 };
const launcherListeners = new Set<() => void>();
function setLauncher(next: LauncherState) {
  launcher = next;
  launcherListeners.forEach((f) => f());
}
/** Open GIDEON, optionally about a project/task (the context chip). */
export function openGideon(context?: GideonContext | null, opts: { chatId?: string | null; newChat?: boolean } = {}) {
  setLauncher({ open: true, context: context ?? null, nonce: launcher.nonce + 1, chatId: opts.chatId ?? null, newChat: opts.newChat ?? false });
}
export function closeGideon() {
  setLauncher({ ...launcher, open: false });
}
export function clearGideonContext() {
  setLauncher({ ...launcher, context: null });
}
export function useGideonLauncher(): LauncherState {
  return useSyncExternalStore(
    (f) => { launcherListeners.add(f); return () => { launcherListeners.delete(f); }; },
    () => launcher,
    () => launcher,
  );
}
