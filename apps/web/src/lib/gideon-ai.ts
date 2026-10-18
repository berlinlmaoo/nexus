// GIDEON as Notion AI (owner, 12 Oct 2026): conversations with search, personalize, the page context GIDEON
// is opened with, the editor's "Ask AI", "Save as doc", and AI Autofill. Server side: src/app/api/gideon/
// (chats, prefs, context, write, save-doc, autofill). Everything runs with the signed-in person's access.
import { useSyncExternalStore } from "react";
import type { JSONContent } from "@tiptap/core";

async function gjson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", "X-Nexus-Client": "web/1", ...(init?.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = typeof body?.code === "string" ? body.code : undefined;
    throw err;
  }
  return body as T;
}

// ── Conversations ──────────────────────────────────────────────────────────────────────────────────────

export type GideonChatRow = { id: string; title: string | null; createdAt: string; updatedAt: string; messages: number; match: string | null };
export const listGideonChats = (q = "") => gjson<{ chats: GideonChatRow[] }>(`/api/gideon/chats${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
export const renameGideonChat = (id: string, title: string) => gjson<{ chat: { id: string; title: string } }>(`/api/gideon/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
export const deleteGideonChat = (id: string) => gjson<{ ok: boolean }>(`/api/gideon/chats/${id}`, { method: "DELETE" });

// ── Control Room review (One Above All only, 18 Oct 2026) ───────────────────────────────────────────────
// Server: src/app/api/gideon/people/[userId]/… and src/lib/gideon-review.ts. Overview is BoD + OAA; chats and
// transcripts are OAA only (403 code OAA_ONLY). Read-only; the person is not notified and nothing is logged.

export type GideonReviewPerson = { id: string; name: string; email: string | null; avatar: string | null; role: string | null; offboarded: boolean };
export type GideonPersonOverview = {
  person: GideonReviewPerson;
  viewer: { canReadChats: boolean };
  stats: { questions: number; answers: number; toolCalls: number; chats: number; deletedChats: number | null; firstUsed: string | null; lastUsed: string | null };
  credits: { periodKey: string; period: { startKey: string; endKey: string; resetsAt: string }; used: number; answers: number; todayUsed: number; tiers: { tier: string; credits: number; answers: number }[] };
  topTier: { tier: string; answers: number } | null;
};
export type GideonReviewChat = {
  id: string; title: string | null; createdAt: string; updatedAt: string; messages: number; questions: number;
  tier: string | null; tiers: string[]; credits: number; deleted: boolean; deletedAt: string | null; match?: string | null;
};
export type GideonReviewMessage = import("@/lib/gideon").GideonTurn & { id: string; createdAt: string; tier: string | null; credits: number | null };

export const fetchGideonPersonOverview = (userId: string) => gjson<GideonPersonOverview>(`/api/gideon/people/${encodeURIComponent(userId)}`);
export const fetchGideonReviewChats = (userId: string, f: { q?: string; from?: string; to?: string; deleted?: "all" | "only" | "none"; cursor?: string | null; limit?: number }) => {
  const sp = new URLSearchParams();
  if (f.q?.trim()) sp.set("q", f.q.trim());
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (f.deleted && f.deleted !== "all") sp.set("deleted", f.deleted);
  if (f.cursor) sp.set("cursor", f.cursor);
  if (f.limit) sp.set("limit", String(f.limit));
  const qs = sp.toString();
  return gjson<{ chats: GideonReviewChat[]; nextCursor: string | null; total: number }>(`/api/gideon/people/${encodeURIComponent(userId)}/chats${qs ? `?${qs}` : ""}`);
};
export const fetchGideonReviewTranscript = (userId: string, chatId: string, before?: string | null) =>
  gjson<{ person: GideonReviewPerson; chat: GideonReviewChat; messages: GideonReviewMessage[]; olderBefore: string | null }>(
    `/api/gideon/people/${encodeURIComponent(userId)}/chats/${encodeURIComponent(chatId)}${before ? `?before=${encodeURIComponent(before)}` : ""}`,
  );

// ── GIDEON Memory (19 Oct 2026) ─────────────────────────────────────────────────────────────────────────
// Only ever the signed-in person's own memories (server: src/app/api/gideon/memory, lib/gideon-memory.ts).

export type GideonMemoryState = { paused: boolean; available?: boolean; max: number; textMax: number; memories: import("@/lib/gideon").GideonMemory[] };
export const GIDEON_MEMORY_KEY = ["gideon-memory"] as const;
export const getGideonMemory = () => gjson<GideonMemoryState>("/api/gideon/memory");
export const addGideonMemory = (p: { text: string; kind?: string; date?: string | null }) => gjson<{ memory: import("@/lib/gideon").GideonMemory }>("/api/gideon/memory", { method: "POST", body: JSON.stringify(p) });
export const setGideonMemoryPaused = (paused: boolean) => gjson<GideonMemoryState>("/api/gideon/memory", { method: "PATCH", body: JSON.stringify({ paused }) });
export const forgetAllGideonMemory = () => gjson<{ deleted: number }>("/api/gideon/memory", { method: "DELETE" });
export const updateGideonMemory = (id: string, p: { text?: string; kind?: string; date?: string | null; status?: "ACTIVE" }) =>
  gjson<{ memory: import("@/lib/gideon").GideonMemory }>(`/api/gideon/memory/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(p) });
export const deleteGideonMemory = (id: string) => gjson<{ deleted: boolean }>(`/api/gideon/memory/${encodeURIComponent(id)}`, { method: "DELETE" });

// ── Personalize ────────────────────────────────────────────────────────────────────────────────────────

/** reviewNotice: show the one-time "chats can be reviewed by the BoD" notice (until dismissed with reviewNoticeSeen). */
export type GideonPrefs = { assistantName: string | null; instructions: string | null; updatedAt: string | null; reviewNotice?: boolean };
export const getGideonPrefs = () => gjson<GideonPrefs>("/api/gideon/prefs");
export const saveGideonPrefs = (p: { assistantName?: string | null; instructions?: string | null; reviewNoticeSeen?: boolean }) => gjson<GideonPrefs>("/api/gideon/prefs", { method: "PUT", body: JSON.stringify(p) });

let prefsCache: GideonPrefs | null = null;
const prefsListeners = new Set<() => void>();
export function setCachedGideonPrefs(p: GideonPrefs) { prefsCache = p; prefsListeners.forEach((f) => f()); }
export function useGideonPrefs(): GideonPrefs | null {
  return useSyncExternalStore((f) => { prefsListeners.add(f); return () => { prefsListeners.delete(f); }; }, () => prefsCache, () => prefsCache);
}
/** What this person calls GIDEON ("GIDEON" unless they personalised it). */
export function useGideonName(): string {
  return useGideonPrefs()?.assistantName?.trim() || "GIDEON";
}

// ── The page GIDEON is opened from (auto context chip) ─────────────────────────────────────────────────

export type GideonPageRef = { kind: "project" | "task" | "doc"; id: string; title: string; projectId?: string | null; projectName?: string | null };
let pageStack: GideonPageRef[] = [];
const pageListeners = new Set<() => void>();
/** A page announces itself while it is on screen (project page, task popup, doc). The newest wins. Returns the undo. */
export function pushGideonPage(ref: GideonPageRef): () => void {
  pageStack = [...pageStack.filter((r) => !(r.kind === ref.kind && r.id === ref.id)), ref];
  pageListeners.forEach((f) => f());
  return () => {
    pageStack = pageStack.filter((r) => !(r.kind === ref.kind && r.id === ref.id));
    pageListeners.forEach((f) => f());
  };
}
export function useGideonPage(): GideonPageRef | null {
  return useSyncExternalStore((f) => { pageListeners.add(f); return () => { pageListeners.delete(f); }; }, () => pageStack[pageStack.length - 1] ?? null, () => null);
}

// ── Panel layout: floating card or docked side panel; full page is the /gideon route ───────────────────

export type GideonLayout = "float" | "side";
let layout: GideonLayout = (() => { try { return localStorage.getItem("gideon-layout") === "side" ? "side" : "float"; } catch { return "float"; } })();
const layoutListeners = new Set<() => void>();
export function setGideonLayout(next: GideonLayout) {
  layout = next;
  try { localStorage.setItem("gideon-layout", next); } catch { /* private mode */ }
  layoutListeners.forEach((f) => f());
}
export function useGideonLayout(): GideonLayout {
  return useSyncExternalStore((f) => { layoutListeners.add(f); return () => { layoutListeners.delete(f); }; }, () => layout, () => layout);
}

// ── The editor that is open (for "Insert into doc") ────────────────────────────────────────────────────

export type GideonEditorTarget = { key: string; title: string; insert: (doc: JSONContent) => void };
let editors: GideonEditorTarget[] = [];
const editorListeners = new Set<() => void>();
export function registerGideonEditor(target: GideonEditorTarget): () => void {
  editors = [...editors.filter((e) => e.key !== target.key), target];
  editorListeners.forEach((f) => f());
  return () => { editors = editors.filter((e) => e.key !== target.key); editorListeners.forEach((f) => f()); };
}
export function useGideonEditorTarget(): GideonEditorTarget | null {
  return useSyncExternalStore((f) => { editorListeners.add(f); return () => { editorListeners.delete(f); }; }, () => editors[editors.length - 1] ?? null, () => null);
}

export const saveGideonAnswerAsDoc = (projectId: string, title: string, markdown: string) =>
  gjson<{ doc: { id: string; title: string; url: string } }>("/api/gideon/save-doc", { method: "POST", body: JSON.stringify({ projectId, title, markdown }) });

// ── Markdown → editor JSON (the shapes GIDEON writes: headings, lists, to-dos, quotes, rules, marks) ───

function inline(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) nodes.push({ type: "text", text: text.slice(last, m.index) });
    if (m[2] !== undefined) nodes.push({ type: "text", text: m[2], marks: [{ type: "bold" }] });
    else if (m[4] !== undefined) nodes.push({ type: "text", text: m[4], marks: [{ type: "italic" }] });
    else if (m[5] !== undefined) nodes.push({ type: "text", text: m[5], marks: [{ type: "code" }] });
    else if (m[6] !== undefined) nodes.push({ type: "text", text: m[6], marks: [{ type: "link", attrs: { href: m[7] } }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.filter((n) => n.text);
}

export function markdownToDoc(markdown: string): JSONContent {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const content: JSONContent[] = [];
  let para: string[] = [];
  let list: { kind: "bullet" | "ordered" | "task"; items: Array<{ text: string; checked: boolean }> } | null = null;
  const p = (text: string): JSONContent => { const c = inline(text); return c.length ? { type: "paragraph", content: c } : { type: "paragraph" }; };
  const flushPara = () => { if (para.length) { content.push(p(para.join(" "))); para = []; } };
  const flushList = () => {
    if (!list) return;
    if (list.kind === "task") content.push({ type: "taskList", content: list.items.map((i) => ({ type: "taskItem", attrs: { checked: i.checked }, content: [p(i.text)] })) });
    else content.push({ type: list.kind === "ordered" ? "orderedList" : "bulletList", content: list.items.map((i) => ({ type: "listItem", content: [p(i.text)] })) });
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); content.push({ type: "heading", attrs: { level: Math.min(3, h[1].length) }, content: inline(h[2]) }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flush(); content.push({ type: "horizontalRule" }); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flush(); content.push({ type: "blockquote", content: [p(q[1])] }); continue; }
    const task = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (task || bullet || ordered) {
      flushPara();
      const kind = task ? "task" : ordered ? "ordered" : "bullet";
      if (list && list.kind !== kind) flushList();
      list = list ?? { kind, items: [] };
      list.items.push(task ? { text: task[2], checked: task[1].toLowerCase() === "x" } : { text: (bullet ?? ordered)![1], checked: false });
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flush();
  if (!content.length) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

// ── Ask AI in the editor ───────────────────────────────────────────────────────────────────────────────

export type GideonWriteAction = "improve" | "fix" | "shorter" | "longer" | "tone" | "summarize" | "translate" | "continue" | "explain" | "action_items" | "custom";
export type GideonActionItem = { title: string; due?: string | null; owner?: string | null };
export type GideonWriteEvent =
  | { type: "run"; id: string }
  | { type: "delta"; content: string }
  | { type: "reset" }
  | { type: "final"; content: string; doc?: JSONContent | null; items?: GideonActionItem[] }
  | { type: "error"; content?: string }
  | { type: "done" };

export async function streamGideonWrite(
  body: { action: GideonWriteAction; text: string; context?: string; docTitle?: string; tone?: string; language?: "en" | "id"; prompt?: string; docId?: string; taskId?: string },
  onEvent: (e: GideonWriteEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/gideon/write", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Nexus-Client": "web/1" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try { const j = (await res.json()) as { error?: string }; if (j?.error) message = j.error; } catch { /* not JSON */ }
    onEvent({ type: "error", content: message });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5).trim()) as GideonWriteEvent); } catch { /* malformed frame */ }
    }
  }
}

// ── AI Autofill ────────────────────────────────────────────────────────────────────────────────────────

export type AutofillMode = "summary" | "classify" | "extract";
export type AutofillConfig = {
  customFieldId: string; projectId: string; enabled: boolean; mode: AutofillMode; prompt: string | null; onCreate: boolean; onUpdate: boolean;
  approval: "review" | "auto"; lastRunAt: string | null; lastStatus: string | null; updatedAt: string;
  lastResult: { at: string; filled: number; proposed: number; skipped: number; error: string | null } | null;
};
export type AutofillMark = { customFieldId: string; taskId: string; value: string };
export const AUTOFILL_FIELD_TYPES = ["TEXT", "URL", "NUMBER", "SELECT", "DROPDOWN", "MULTI_SELECT", "STATUS", "DATE"];
export const getAutofill = (projectId: string) =>
  gjson<{ configs: AutofillConfig[]; marks: AutofillMark[]; canManage: boolean; configured: boolean }>(`/api/gideon/autofill?projectId=${encodeURIComponent(projectId)}`);
export const saveAutofill = (body: Partial<Omit<AutofillConfig, "lastResult" | "lastRunAt" | "lastStatus" | "updatedAt" | "projectId">> & { customFieldId: string }) =>
  gjson<{ config: AutofillConfig }>("/api/gideon/autofill", { method: "PUT", body: JSON.stringify(body) });
export const removeAutofill = (customFieldId: string) => gjson<{ ok: boolean }>(`/api/gideon/autofill?customFieldId=${encodeURIComponent(customFieldId)}`, { method: "DELETE" });
export const runAutofillNow = (customFieldId: string, scope: "empty" | "all" | "tasks", taskIds?: string[]) =>
  gjson<{ started: boolean; count: number; remaining: number }>("/api/gideon/autofill/run", { method: "POST", body: JSON.stringify({ customFieldId, scope, taskIds }) });
