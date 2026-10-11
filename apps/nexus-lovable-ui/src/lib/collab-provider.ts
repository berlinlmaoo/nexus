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
      this.emit();
    });
    on<{ room: string; reason: string }>("ydoc:reset", (d) => {
      if (d?.room === this.room) this.resetListeners.forEach((f) => f(d.reason));
    });
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
        resolve(true);
      });
    });
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.destroyed) return;
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

/** A stable colour per person for cursors and avatars rings. */
export function colorFor(id: string): string {
  const palette = ["#e5484d", "#f76b15", "#d6a000", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
