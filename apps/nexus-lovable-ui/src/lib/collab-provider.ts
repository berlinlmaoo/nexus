import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { Socket } from "socket.io-client";
import { getSocket } from "./socket";

/**
 * Yjs over the NEXUS Socket.IO server (server side: src/lib/collab-rooms.ts; protocol described there).
 *
 * The server holds each room's document, seeds it from the stored JSON and saves it, so this provider
 * only syncs: join → apply the server's state (and send whatever we have that it lacks, after a
 * reconnect), relay updates and awareness (cursors, who is here) both ways.
 *
 * `epoch` is the lineage of the server's document. A reconnect into another epoch (the page was
 * rewritten elsewhere and the room reset) cannot merge: the provider reports "reset" and the editor
 * starts over from the new document.
 */

export type CollabUser = { id: string; name: string; color: string; avatar?: string | null };
export type CollabStatus = "connecting" | "live" | "offline" | "denied";
type JoinReply = { ok: true; room: string; epoch: string; canWrite: boolean; state: ArrayBuffer | Uint8Array } | { ok: false; error: string };

const toU8 = (v: ArrayBuffer | Uint8Array | number[]) => (v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : Uint8Array.from(v));

/**
 * Every local edit the server has not confirmed as saved is also kept in localStorage, so closing or
 * reloading the tab while offline — or while a dropped connection has not been noticed yet — does not lose
 * it ("changes are kept here" — bughunt E-BUG-2). The next time the page is joined in the same epoch the
 * kept edits are merged and sent (already-known ones are a no-op); another epoch cannot merge and drops
 * them. Cleared on a server save that came after the last local edit.
 */
const STASH_PREFIX = "nx-ydoc-stash:";
type Stash = { epoch: string; update: string };
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function readStash(room: string): Stash | null {
  try {
    const raw = localStorage.getItem(STASH_PREFIX + room);
    const v = raw ? (JSON.parse(raw) as Stash) : null;
    return v && typeof v.epoch === "string" && typeof v.update === "string" ? v : null;
  } catch { return null; }
}
function writeStash(room: string, v: Stash | null) {
  try {
    if (v) localStorage.setItem(STASH_PREFIX + room, JSON.stringify(v));
    else localStorage.removeItem(STASH_PREFIX + room);
  } catch { /* storage full or blocked: the in-memory copy still syncs on reconnect */ }
}

export class SocketYProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: string;
  canWrite = false;
  epoch: string | null = null;
  status: CollabStatus = "connecting";
  /** Local changes the server has not confirmed as saved yet. */
  pending = false;
  lastSavedAt: string | null = null;
  /** Local edits not confirmed saved yet (merged Yjs update), mirrored to localStorage (STASH_PREFIX). */
  private unsaved: Uint8Array | null = null;
  private lastLocalAt = 0;
  private stashTimer: ReturnType<typeof setTimeout> | undefined;
  private writeStashNow = () => {
    clearTimeout(this.stashTimer);
    this.stashTimer = undefined;
    if (this.epoch) writeStash(this.room, this.unsaved ? { epoch: this.epoch, update: b64(this.unsaved) } : null);
  };

  private socket: Socket | null = null;
  private destroyed = false;
  private listeners = new Set<() => void>();
  private resetListeners = new Set<(reason: string) => void>();
  private offHandlers: Array<() => void> = [];

  constructor(room: string, doc: Y.Doc, user: CollabUser) {
    this.room = room;
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField("user", user);
    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
  }

  /** Join the room. Resolves true when synced, false when the socket is unavailable or access is refused. */
  async connect(timeoutMs = 5000): Promise<boolean> {
    let socket: Socket;
    try {
      socket = await Promise.race([getSocket(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]);
    } catch {
      this.setStatus("offline");
      return false;
    }
    if (this.destroyed) return false;
    this.socket = socket;
    const on = <T,>(event: string, fn: (data: T) => void) => {
      socket.on(event, fn as never);
      this.offHandlers.push(() => socket.off(event, fn as never));
    };
    on<{ room: string; update: ArrayBuffer }>("ydoc:update", (d) => {
      if (d?.room !== this.room) return;
      Y.applyUpdate(this.doc, toU8(d.update), this);
    });
    on<{ room: string; update: ArrayBuffer }>("ydoc:awareness", (d) => {
      if (d?.room !== this.room) return;
      applyAwarenessUpdate(this.awareness, toU8(d.update), this);
    });
    on<{ room: string }>("ydoc:hello", (d) => {
      if (d?.room === this.room) this.sendAwareness([this.doc.clientID]);
    });
    on<{ room: string; clientIds: number[] }>("ydoc:gone", (d) => {
      if (d?.room === this.room && Array.isArray(d.clientIds)) removeAwarenessStates(this.awareness, d.clientIds.filter((c) => c !== this.doc.clientID), this);
    });
    on<{ room: string; at: string }>("ydoc:saved", (d) => {
      if (d?.room !== this.room) return;
      this.lastSavedAt = d.at;
      this.pending = false;
      if (this.status === "live" && this.unsaved && Date.now() - this.lastLocalAt > 1000) { this.unsaved = null; this.writeStashNow(); }
      this.emit();
    });
    on<{ room: string; reason: string }>("ydoc:reset", (d) => {
      if (d?.room === this.room) this.resetListeners.forEach((f) => f(d.reason));
    });
    const onHide = () => { if (this.stashTimer) this.writeStashNow(); };
    window.addEventListener("pagehide", onHide);
    this.offHandlers.push(() => window.removeEventListener("pagehide", onHide));
    // Reconnected (network drop, a deploy): join again and merge what we typed meanwhile.
    on<void>("connect", () => { void this.join(timeoutMs); });
    on<void>("disconnect", () => this.setStatus("offline"));
    return this.join(timeoutMs);
  }

  private join(timeoutMs: number): Promise<boolean> {
    const socket = this.socket;
    if (!socket || this.destroyed) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; this.setStatus("offline"); resolve(false); } }, timeoutMs);
      socket.emit("ydoc:join", { room: this.room, clientId: this.doc.clientID }, (res: JoinReply) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!res || !res.ok) {
          this.setStatus(res && !res.ok && res.error === "forbidden" ? "denied" : "offline");
          resolve(false);
          return;
        }
        const stash = firstSyncStash(this.epoch, this.room);
        if (this.epoch && this.epoch !== res.epoch) {
          // Another lineage: merging would duplicate the page. Start over.
          this.resetListeners.forEach((f) => f("epoch"));
          resolve(false);
          return;
        }
        const firstSync = !this.epoch;
        this.epoch = res.epoch;
        this.canWrite = res.canWrite;
        const serverState = toU8(res.state);
        const serverVector = Y.encodeStateVectorFromUpdate(serverState);
        Y.applyUpdate(this.doc, serverState, this);
        if (!firstSync && this.canWrite) {
          // What we have that the server lacks (typed while disconnected).
          const missing = Y.encodeStateAsUpdate(this.doc, serverVector);
          if (missing.byteLength > 2) socket.emit("ydoc:update", { room: this.room, update: missing });
        }
        this.sendAwareness([this.doc.clientID]);
        this.setStatus("live");
        // Offline edits kept from an earlier visit (tab closed before reconnecting): merge and send them.
        if (stash) {
          if (stash.epoch === res.epoch && this.canWrite) {
            try { Y.applyUpdate(this.doc, unb64(stash.update), "stash"); } catch { writeStash(this.room, null); }
          } else writeStash(this.room, null);
        }
        resolve(true);
      });
    });
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.destroyed) return;
    if (this.epoch && this.canWrite) {
      this.unsaved = this.unsaved ? Y.mergeUpdates([this.unsaved, update]) : update;
      this.lastLocalAt = Date.now();
      // Offline: write now (the tab may close any moment). Online: at most every 400 ms while typing.
      if (this.status !== "live") this.writeStashNow();
      else if (!this.stashTimer) this.stashTimer = setTimeout(this.writeStashNow, 400);
    }
    if (!this.socket?.connected || this.status !== "live" || !this.canWrite) {
      this.pending = true;
      this.emit();
      return;
    }
    this.socket.emit("ydoc:update", { room: this.room, update });
    this.pending = true;
    this.emit();
  };

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) {
      this.emit();
      return;
    }
    this.sendAwareness([...added, ...updated, ...removed]);
    this.emit();
  };

  private sendAwareness(clients: number[]) {
    if (!this.socket?.connected || this.status === "denied" || !clients.length) return;
    this.socket.emit("ydoc:awareness", { room: this.room, update: encodeAwarenessUpdate(this.awareness, clients), clientId: this.doc.clientID });
  }

  private setStatus(s: CollabStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit();
  }

  private emit() {
    this.listeners.forEach((f) => f());
  }

  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => { this.listeners.delete(f); };
  }

  onReset(f: (reason: string) => void) {
    this.resetListeners.add(f);
    return () => { this.resetListeners.delete(f); };
  }

  /** Other people in the room (one entry per person, however many tabs). */
  peers(): CollabUser[] {
    const seen = new Map<string, CollabUser>();
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.doc.clientID) return;
      const u = (state as { user?: CollabUser }).user;
      if (u?.id && !seen.has(u.id)) seen.set(u.id, u);
    });
    return [...seen.values()];
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.stashTimer) this.writeStashNow();
    removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    this.socket?.emit("ydoc:leave", { room: this.room });
    this.offHandlers.forEach((f) => f());
    this.offHandlers = [];
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    this.listeners.clear();
    this.resetListeners.clear();
  }
}

/** The stash to merge on the first join of this page in this tab (later joins resend from memory). */
function firstSyncStash(epoch: string | null, room: string): Stash | null {
  return epoch ? null : readStash(room);
}

/** A stable colour per person for cursors and avatars rings. */
export function colorFor(id: string): string {
  const palette = ["#e5484d", "#f76b15", "#d6a000", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
