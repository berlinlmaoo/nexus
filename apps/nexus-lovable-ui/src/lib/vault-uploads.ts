import { useSyncExternalStore } from "react";
import { ApiError, isAbort, nexusApi, type VaultItem } from "@/lib/nexus-api";

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault uploads, app-wide (owner, 9 Oct 2026: "progress upload ga detail … pop up di tengah yang
// bisa di-minimize, jalan di background, kelihatan berapa file dan progress per MB").
//
// The queue lives here, in a module, not in the Vault page: an upload keeps going while the person
// moves around the app, and the panel that shows it (components/vault/VaultUploadPanel.tsx) is
// mounted once in the app layout. One file at a time on purpose — the server caps how many chunked
// uploads one person may have open, and sending ten at once only collects 429s.
//
// Errors are stored as English source text plus values and translated when drawn, so switching the
// language while a failure is listed shows it in the new language.
// ─────────────────────────────────────────────────────────────────────────────

export type UploadState = "queued" | "uploading" | "done" | "failed" | "cancelled";

/** English source text for t(), with its placeholders. */
export type UploadMessage = { text: string; vars?: Record<string, string | number> };

export type UploadEntry = {
  id: string;
  file: File;
  name: string;
  size: number;
  folderId: string | null;
  folderName: string;
  /** Set for "Replace file…": the item whose bytes this replaces. */
  replace?: { itemId: string; itemName: string };
  state: UploadState;
  /** Bytes of the file sent so far. */
  sent: number;
  error?: UploadMessage;
};

export type UploadView = "card" | "pill" | "hidden";
type Snapshot = { entries: UploadEntry[]; view: UploadView };

let snap: Snapshot = { entries: [], view: "hidden" };
const listeners = new Set<() => void>();
const landedListeners = new Set<(item: VaultItem, entry: UploadEntry) => void>();
const controllers = new Map<string, AbortController>();
let running = false;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

function emit(next: Partial<Snapshot>) {
  snap = { ...snap, ...next };
  listeners.forEach((f) => f());
}
function patch(id: string, p: Partial<UploadEntry>) {
  emit({ entries: snap.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) });
}
function clearDismiss() {
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
}

const isActive = (e: UploadEntry) => e.state === "queued" || e.state === "uploading";

/** What went wrong, in words that say what failed — never just "Failed to upload". */
export function describeUploadError(e: unknown, file: File): UploadMessage {
  if (e instanceof DOMException && e.name === "NotReadableError") return { text: "Couldn't read this file." };
  if (e instanceof ApiError) {
    switch (e.status) {
      case 507: return { text: "The vault is full. Empty the trash or ask BoD for more space." };
      case 403: return { text: "You can't add files to this folder." };
      case 404: return { text: "This folder no longer exists." };
      case 413: return { text: "This file is too big to upload (max 1 GB)." };
      case 429: return { text: "Too many uploads at once. Try again in a moment." };
      case 401: return { text: "Your session has ended. Sign in again, then retry." };
      case 0: return { text: "Can't reach NEXUS. Check your connection and retry." };
    }
    if (e.status >= 500) return { text: "The server couldn't save the file ({status}). Try again.", vars: { status: e.status } };
    if (file.size === 0) return { text: "This file is empty." };
    return { text: "The server refused the file: {reason}", vars: { reason: e.message } };
  }
  // XMLHttpRequest's onerror: the request never got an answer.
  return { text: "Can't reach NEXUS. Check your connection and retry." };
}

async function runOne(entry: UploadEntry) {
  const controller = new AbortController();
  controllers.set(entry.id, controller);
  patch(entry.id, { state: "uploading", sent: 0, error: undefined });
  // XHR progress fires many times a second; the panel needs ten at most.
  let last = 0;
  const onBytes = (sent: number) => {
    const now = Date.now();
    if (now - last < 100 && sent < entry.size) return;
    last = now;
    patch(entry.id, { sent });
  };
  try {
    if (entry.size === 0) throw new ApiError(400, "empty", null);
    const control = { signal: controller.signal, onBytes };
    const item = entry.replace
      ? await nexusApi.vaultReplace(entry.replace.itemId, entry.file, () => {}, control)
      : await nexusApi.vaultUpload(entry.file, entry.folderId, () => {}, control);
    patch(entry.id, { state: "done", sent: entry.size });
    landedListeners.forEach((f) => f(item, entry));
  } catch (e) {
    if (isAbort(e) || controller.signal.aborted) patch(entry.id, { state: "cancelled" });
    else patch(entry.id, { state: "failed", error: describeUploadError(e, entry.file) });
  } finally {
    controllers.delete(entry.id);
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = snap.entries.find((e) => e.state === "queued");
      if (!next) break;
      await runOne(next);
    }
  } finally {
    running = false;
  }
  settle();
}

/** Everything has stopped: a clean run says so briefly and goes; failures stay until closed. */
function settle() {
  if (snap.entries.some(isActive)) return;
  const done = snap.entries.filter((e) => e.state === "done").length;
  const failed = snap.entries.filter((e) => e.state === "failed").length;
  clearDismiss();
  if (failed > 0) return;
  if (done === 0) { emit({ entries: [], view: "hidden" }); return; }
  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    if (snap.entries.some(isActive) || snap.entries.some((e) => e.state === "failed")) return;
    emit({ entries: [], view: "hidden" });
  }, 2500);
}

function add(entries: Omit<UploadEntry, "id" | "state" | "sent">[]) {
  if (!entries.length) return;
  clearDismiss();
  // A new batch after a finished one starts the count again; failures still listed stay with it.
  const keep = snap.entries.some(isActive)
    ? snap.entries
    : snap.entries.filter((e) => e.state === "failed");
  const fresh = entries.map((e) => ({ ...e, id: `u${++seq}`, state: "queued" as const, sent: 0 }));
  emit({ entries: [...keep, ...fresh], view: snap.view === "pill" ? "pill" : "card" });
  void pump();
}

export const vaultUploads = {
  /** Files into a folder (null = the top of the vault). */
  enqueue(files: File[], to: { id: string | null; name: string }) {
    add(files.map((file) => ({ file, name: file.name, size: file.size, folderId: to.id, folderName: to.name })));
  },
  /** "Replace file…": new bytes for an existing item, through the same queue. */
  enqueueReplace(item: VaultItem, file: File, folderName: string) {
    add([{ file, name: item.name, size: file.size, folderId: item.parentId, folderName, replace: { itemId: item.id, itemName: item.name } }]);
  },
  cancel(id: string) {
    const entry = snap.entries.find((e) => e.id === id);
    if (!entry) return;
    if (entry.state === "queued") { patch(id, { state: "cancelled" }); settle(); }
    else if (entry.state === "uploading") controllers.get(id)?.abort();
  },
  cancelAll() {
    emit({ entries: snap.entries.map((e) => (e.state === "queued" ? { ...e, state: "cancelled" as const } : e)) });
    controllers.forEach((c) => c.abort());
    settle();
  },
  retry(id: string) {
    const entry = snap.entries.find((e) => e.id === id);
    if (!entry || (entry.state !== "failed" && entry.state !== "cancelled")) return;
    clearDismiss();
    patch(id, { state: "queued", sent: 0, error: undefined });
    if (snap.view === "hidden") emit({ view: "card" });
    void pump();
  },
  minimize() { if (snap.entries.length) emit({ view: "pill" }); },
  expand() { if (snap.entries.length) emit({ view: "card" }); },
  /** Close: with anything still going this only minimizes — closing must never stop an upload. */
  close() {
    if (snap.entries.some(isActive)) { emit({ view: "pill" }); return; }
    clearDismiss();
    emit({ entries: [], view: "hidden" });
  },
  /** Called with each item the server has stored. Returns the unsubscribe. */
  onLanded(f: (item: VaultItem, entry: UploadEntry) => void) {
    landedListeners.add(f);
    return () => { landedListeners.delete(f); };
  },
  isBusy() { return snap.entries.some(isActive); },
};

function subscribe(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** The queue and how the panel is shown; re-renders on every change. */
export function useVaultUploads(): Snapshot {
  return useSyncExternalStore(subscribe, () => snap, () => snap);
}

/** The numbers the panel and the pill both show. Cancelled files are out of the count; a failed one
 *  stays in "of N" but its bytes are not counted as sent. */
export function uploadTotals(entries: UploadEntry[]) {
  const counted = entries.filter((e) => e.state !== "cancelled");
  const finished = counted.filter((e) => e.state === "done" || e.state === "failed").length;
  const uploading = counted.some((e) => e.state === "uploading");
  const live = counted.filter((e) => e.state !== "failed");
  const totalBytes = live.reduce((n, e) => n + e.size, 0);
  const sentBytes = live.reduce((n, e) => n + (e.state === "done" ? e.size : e.state === "uploading" ? e.sent : 0), 0);
  return {
    total: counted.length,
    /** The file being sent, 1-based ("2 of 5"); after everything, the count of finished files. */
    current: Math.min(counted.length, finished + (uploading ? 1 : 0)),
    done: counted.filter((e) => e.state === "done").length,
    failed: counted.filter((e) => e.state === "failed").length,
    active: counted.some(isActive),
    sentBytes,
    totalBytes,
    pct: totalBytes > 0 ? Math.min(100, Math.round((sentBytes / totalBytes) * 100)) : 0,
  };
}
