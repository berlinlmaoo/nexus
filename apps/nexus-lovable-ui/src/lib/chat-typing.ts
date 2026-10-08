import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Socket } from "socket.io-client";

/**
 * "… is typing", like WhatsApp (owner, 9 Oct 2026: "bikin status titik titik gitu kaya wa kalo ada orang
 * lain atau lawan bicara pas lg ngetik", and the typer's photo beside the dots).
 *
 * The server relays `typing` { conversationId, userId, name, avatar, typing } to the room's open threads
 * and to every member's own room, so a chat list hears it too (pages/api/socket.ts). Name and photo are
 * the server's, never another client's. Nothing is stored; with the socket down nothing is sent and
 * nothing is shown.
 *
 *   sending    while the composer has text and keys are pressed: "typing" at most every TYPING_RESEND_MS;
 *              "stopped" on send, on clearing the box, on blur, after TYPING_IDLE_MS without a key, and on
 *              leaving the room.
 *   receiving  a typer stays shown TYPING_EXPIRE_MS after their last "typing" unless "stopped" (or their
 *              message) comes first. Everything clears when the socket drops.
 */

export type Typer = { userId: string; name: string; avatar: string | null };

export const TYPING_RESEND_MS = 3_000;
export const TYPING_IDLE_MS = 5_000;
export const TYPING_EXPIRE_MS = 6_000;

type Entry = Typer & { timer: ReturnType<typeof setTimeout> };

const rooms = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
const NONE: Typer[] = [];
// A new map on every change, so useSyncExternalStore sees a new snapshot; unchanged rooms keep their array.
let snapshot: ReadonlyMap<string, Typer[]> = new Map();

function publish() {
  const next = new Map<string, Typer[]>();
  for (const [id, people] of rooms) {
    if (people.size) next.set(id, Array.from(people.values(), ({ userId, name, avatar }) => ({ userId, name, avatar })));
  }
  snapshot = next;
  for (const l of listeners) l();
}

function drop(conversationId: string, userId: string): boolean {
  const people = rooms.get(conversationId);
  const entry = people?.get(userId);
  if (!people || !entry) return false;
  clearTimeout(entry.timer);
  people.delete(userId);
  if (!people.size) rooms.delete(conversationId);
  return true;
}

function clearAll() {
  if (!rooms.size) return;
  for (const people of rooms.values()) for (const e of people.values()) clearTimeout(e.timer);
  rooms.clear();
  publish();
}

/**
 * Listens on the app's socket (realtime.tsx, once per connection). `meId`: the viewer's own typing from
 * another tab is never shown. Returns the cleanup.
 */
export function bindTypingSocket(socket: Socket, meId?: string): () => void {
  const onTyping = (payload: unknown) => {
    const p = (payload && typeof payload === "object" ? payload : {}) as Partial<Record<"conversationId" | "userId" | "name" | "avatar" | "typing", unknown>>;
    if (typeof p.conversationId !== "string" || typeof p.userId !== "string" || typeof p.typing !== "boolean") return;
    if (p.userId === meId) return;
    const conversationId = p.conversationId;
    const userId = p.userId;
    if (!p.typing) {
      if (drop(conversationId, userId)) publish();
      return;
    }
    drop(conversationId, userId);
    const timer = setTimeout(() => { if (drop(conversationId, userId)) publish(); }, TYPING_EXPIRE_MS);
    if (!rooms.has(conversationId)) rooms.set(conversationId, new Map());
    rooms.get(conversationId)!.set(userId, {
      userId,
      name: typeof p.name === "string" ? p.name : "",
      avatar: typeof p.avatar === "string" && p.avatar ? p.avatar : null,
      timer,
    });
    publish();
  };
  // Their message landed: they are done typing it.
  const onMessage = (payload: unknown) => {
    const m = (payload && typeof payload === "object" ? payload : {}) as { conversationId?: unknown; userId?: unknown };
    if (typeof m.conversationId === "string" && typeof m.userId === "string" && drop(m.conversationId, m.userId)) publish();
  };
  socket.on("typing", onTyping);
  socket.on("message-created", onMessage);
  socket.on("disconnect", clearAll);
  return () => {
    socket.off("typing", onTyping);
    socket.off("message-created", onMessage);
    socket.off("disconnect", clearAll);
    clearAll();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const getSnapshot = () => snapshot;

/** Who is typing in every room right now (the chat list). */
export function useTypingRooms(): ReadonlyMap<string, Typer[]> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Who is typing in this room right now (the thread, its header). */
export function useTypers(conversationId: string | null | undefined): Typer[] {
  const all = useTypingRooms();
  return (conversationId && all.get(conversationId)) || NONE;
}

/**
 * The composer's half. `onInput(text)` on every change of the box; `stop()` on send and on blur. Leaving
 * the room (another chat, the page) stops by itself. Sends nothing while the socket is down.
 */
export function useTypingSender(socket: Socket | null, conversationId: string) {
  const state = useRef({ room: conversationId, active: false, lastSent: 0, idle: null as ReturnType<typeof setTimeout> | null });

  const stop = useCallback(() => {
    const s = state.current;
    if (s.idle) clearTimeout(s.idle);
    s.idle = null;
    if (!s.active) return;
    s.active = false;
    s.lastSent = 0;
    if (socket?.connected) socket.emit("typing", { conversationId: s.room, typing: false });
  }, [socket]);

  const onInput = useCallback((text: string) => {
    const s = state.current;
    if (!text.trim()) { stop(); return; }
    if (!socket?.connected) return;
    const now = Date.now();
    if (!s.active || now - s.lastSent >= TYPING_RESEND_MS) {
      socket.emit("typing", { conversationId: s.room, typing: true });
      s.active = true;
      s.lastSent = now;
    }
    if (s.idle) clearTimeout(s.idle);
    s.idle = setTimeout(stop, TYPING_IDLE_MS);
  }, [socket, stop]);

  // Another room, or the thread closing: "stopped" for the room being left (the server also sends it
  // when the socket leaves the room or drops).
  useEffect(() => {
    state.current.room = conversationId;
    return () => stop();
  }, [conversationId, stop]);

  // The socket dropped: the server has already told the others; start fresh on the next keystroke.
  useEffect(() => {
    if (!socket) return;
    const reset = () => {
      const s = state.current;
      s.active = false;
      s.lastSent = 0;
      if (s.idle) clearTimeout(s.idle);
      s.idle = null;
    };
    socket.on("disconnect", reset);
    return () => { socket.off("disconnect", reset); };
  }, [socket]);

  return { onInput, stop };
}
