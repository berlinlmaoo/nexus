import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { getSocket } from "./socket";
import { invalidateAuditViews, invalidateProjectViews } from "./invalidate";

// SOCKET event names → query invalidation.
//
// These are the names the server passes to io.emit (pages/api/socket.ts), NOT the bus event names
// in src/lib/event-bus.ts. Six of the seven happen to be identical, which is why the mismatch went
// unnoticed: the bus calls it "notification" but the socket emits "new-notification", so this
// listener never fired once and the bell only ever moved on a refetch. Check against the emit
// calls, not the bus constants, when adding one.
const REALTIME_EVENTS = [
  "task-created",
  "task-updated",
  "task-deleted",
  "comment-added",
  "new-notification",
  "sprint-updated",
  "message-created",
  // Server since 8 Oct 2026: to every member's user:<id> room on each new message, so the list,
  // the nav badge and the tab title move for chats that aren't open. Older servers never send it;
  // the "new-notification" fallback below and the list's own poll cover them.
  "conversation-updated",
] as const;

// Each event invalidates any query whose key contains one of these terms (substring, case-insensitive).
const INVALIDATION: Record<string, string[]> = {
  "task-created": ["task", "dashboard", "project"],
  "task-updated": ["task", "dashboard", "project"],
  "task-deleted": ["task", "dashboard", "project"],
  "comment-added": ["task", "comment"],
  "new-notification": ["notification"],
  "sprint-updated": ["sprint", "project", "dashboard"],
  "message-created": ["messages", "conversation"],
  "conversation-updated": ["conversation"],
};

/**
 * What a reconnect refetches: anything that only moves on a socket event (chat threads, the
 * conversation list and its badge, the bell). Events emitted while the socket was down are gone
 * for good, so without this an open chat would stay frozen at the moment the connection dropped.
 */
const RECONNECT_TERMS = ["messages", "conversation", "notification", "chat-info"];

/**
 * Realtime diagnostics: every event received is logged with console.debug in dev builds, or anywhere
 * after `localStorage.nexusDebugRealtime = "1"` (then reload). Event name and conversation id only —
 * never message text.
 */
function realtimeDebug(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem("nexusDebugRealtime") === "1";
  } catch {
    return false;
  }
}

/**
 * Query keys that must never be blanket-invalidated, matched as a substring like the terms above.
 *
 * The matching here is deliberately loose — a key part only has to CONTAIN a term — which is how
 * `["nexus","project-sheets",id]` gets swept up by the term "project" and a task update ends up
 * refetching a spreadsheet. For most views that's just wasted bandwidth; for the sheet grid it's
 * destructive, because a refetch landing mid-typing unmounts the cell being edited and the user
 * loses what they were writing.
 *
 * Anything listed here refreshes through its own explicit handler instead (the sheet does surgical
 * setQueryData patches after each save).
 */
const NEVER_BLANKET_INVALIDATE = ["sheet"];

/**
 * `workspace-changed` and `audit-changed` (server since 8 Oct 2026) are pings with no data: the server
 * sends them to rooms it put this socket in by itself (`workspace:<id>` per workspace the user is in,
 * `audit` if they may read the audit log, plus their own `user:<id>`). They name what moved, and the
 * views refetch it through the normal API. Older servers never send them; nothing else depends on them.
 *
 * A burst is folded into one refetch: a drag reorder of 20 folders is 20 PATCHes and 20 pings. Trailing
 * debounce, capped so a steady stream (an import) still refreshes every couple of seconds. The actor's
 * own pings are NOT skipped: their other tabs and devices have to move too.
 */
const PING_DEBOUNCE_MS = 500;
const PING_MAX_WAIT_MS = 2_000;

function keyHasTerm(key: unknown, terms: string[]): boolean {
  const parts = Array.isArray(key) ? key.map((k) => String(k).toLowerCase()) : [String(key).toLowerCase()];
  if (parts.some((p) => NEVER_BLANKET_INVALIDATE.some((x) => p.includes(x)))) return false;
  return parts.some((p) => terms.some((t) => p.includes(t)));
}

interface RealtimeContextValue {
  connected: boolean;
  join: (room: string) => void;
  leave: (room: string) => void;
  /**
   * The raw socket, for features that need their own events rather than query invalidation.
   * Null until the connection is established — every caller must handle that.
   */
  socket: Socket | null;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  join: () => {},
  leave: () => {},
  socket: null,
});

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Join a backend room (e.g. `project:<id>`) for the lifetime of the calling component. */
export function useRealtimeRoom(room: string | null | undefined) {
  const { join, leave, connected } = useRealtime();
  useEffect(() => {
    if (!room) return;
    join(room);
    return () => leave(room);
  }, [room, join, leave, connected]);
}

export function RealtimeProvider({
  userId,
  userName,
  children,
}: {
  userId?: string;
  userName?: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const joinedRooms = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  // State as well as a ref, so consumers re-render once the socket actually exists.
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    getSocket()
      .then((socket) => {
        if (cancelled) return;
        socketRef.current = socket;
        setSocket(socket);

        const joinAll = () => {
          socket.emit("join-room", { room: `user:${userId}`, userId, name: userName });
          joinedRooms.current.forEach((room) =>
            socket.emit("join-room", { room, userId, name: userName }),
          );
        };
        // What the pending workspace/audit pings ask for, flushed as one invalidation per burst.
        const pending = { tree: false, allProjects: false, audit: false, vault: false, projectIds: new Set<string>() };
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        let burstStartedAt = 0;
        const flushPings = () => {
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = null;
          burstStartedAt = 0;
          if (pending.tree) invalidateProjectViews(queryClient, pending.allProjects ? "all" : new Set(pending.projectIds));
          if (pending.audit) invalidateAuditViews(queryClient);
          // Z Vault: the folder on screen, search results, the trash and the Move-to picker, all keyed
          // ["vault", …]. Share dialogs (["vault-shares", id]) refetch on their own when opened.
          if (pending.vault) queryClient.invalidateQueries({ queryKey: ["vault"] });
          pending.tree = false;
          pending.allProjects = false;
          pending.audit = false;
          pending.vault = false;
          pending.projectIds.clear();
        };
        const schedulePings = () => {
          const now = Date.now();
          if (!burstStartedAt) burstStartedAt = now;
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(flushPings, Math.max(0, Math.min(PING_DEBOUNCE_MS, burstStartedAt + PING_MAX_WAIT_MS - now)));
        };
        const onWorkspaceChanged = (payload?: unknown) => {
          const data = (payload && typeof payload === "object" ? payload : {}) as { kind?: unknown; projectId?: unknown };
          if (data.kind === "audit") {
            pending.audit = true;
          } else if (data.kind === "vault") {
            // Server since 9 Oct 2026: a file or folder in Z Vault was added, moved, renamed, trashed,
            // restored or locked. Nothing about projects moved, so the project tree stays as it is.
            pending.vault = true;
          } else {
            // "projects" or "folders" (or a kind a newer server adds): the tree refetches either way, since
            // a folder change moves projects and a project change moves what a folder holds.
            pending.tree = true;
            if (typeof data.projectId === "string") pending.projectIds.add(data.projectId);
          }
          schedulePings();
        };
        const onAuditChanged = () => {
          pending.audit = true;
          schedulePings();
        };

        // The first connect of this provider is the initial load (queries fetch on their own);
        // every later one is a reconnect after a drop, and must catch up on what was missed.
        let connectedBefore = false;
        const debug = realtimeDebug();
        const onConnect = () => {
          if (debug) console.debug("[realtime] connect", { reconnect: connectedBefore, id: socket.id });
          setConnected(true);
          joinAll();
          if (connectedBefore) {
            queryClient.invalidateQueries({ predicate: (q) => keyHasTerm(q.queryKey, RECONNECT_TERMS) });
            // Workspace and audit pings sent while offline are gone too: the project tree, every open
            // project header and the audit catch up now.
            pending.tree = true;
            pending.allProjects = true;
            pending.audit = true;
            pending.vault = true;
            flushPings();
          }
          connectedBefore = true;
        };
        const onDisconnect = (reason?: unknown) => {
          if (debug) console.debug("[realtime] disconnect", reason);
          setConnected(false);
        };
        const onConnectError = (error?: unknown) => {
          if (debug) console.debug("[realtime] connect_error", error instanceof Error ? error.message : error);
        };

        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        socket.on("connect_error", onConnectError);
        socket.on("workspace-changed", onWorkspaceChanged);
        socket.on("audit-changed", onAuditChanged);
        if (socket.connected) onConnect();

        const eventHandlers = REALTIME_EVENTS.map((evt) => {
          const handler = (payload?: unknown) => {
            const terms = [...(INVALIDATION[evt] ?? [])];
            const data = (payload && typeof payload === "object" ? payload : {}) as { type?: unknown; conversationId?: unknown; reason?: unknown; kind?: unknown };
            if (debug) console.debug("[realtime]", evt, { conversationId: data.conversationId, reason: data.reason, kind: data.kind });
            // Servers before 8 Oct 2026 send no conversation-updated, but do write a bell
            // notification (type MESSAGE / MESSAGE_MENTION) for every chat message — so that is
            // the signal that some other chat moved.
            if (evt === "new-notification" && typeof data.type === "string" && data.type.startsWith("MESSAGE")) {
              terms.push("conversation");
            }
            queryClient.invalidateQueries({ predicate: (q) => keyHasTerm(q.queryKey, terms) });
            // The thread of that room too, in case it's on screen but its room join was refused.
            // With `after=` this is a near-empty request when the room event already delivered it.
            if (evt === "conversation-updated" && typeof data.conversationId === "string") {
              queryClient.invalidateQueries({ queryKey: ["messages", data.conversationId] });
              // Someone joined, left, was added or removed, or the group was renamed — possibly me, in a
              // room this tab has never listed. Refetch the list even when no screen is showing it (an
              // invalidation alone only refetches what is on screen), and the room's info drawer.
              if (data.reason === "membership") {
                void queryClient.refetchQueries({ queryKey: ["conversations"], type: "all" });
                queryClient.invalidateQueries({ queryKey: ["chat-info", data.conversationId] });
              }
            }
            // A system line ("Bagas added Mey") in an open room: its member list changed too.
            if (evt === "message-created" && data.kind === "SYSTEM" && typeof data.conversationId === "string") {
              queryClient.invalidateQueries({ queryKey: ["chat-info", data.conversationId] });
            }
          };
          socket.on(evt, handler);
          return () => socket.off(evt, handler);
        });

        cleanups.push(() => {
          socket.off("connect", onConnect);
          socket.off("disconnect", onDisconnect);
          socket.off("connect_error", onConnectError);
          socket.off("workspace-changed", onWorkspaceChanged);
          socket.off("audit-changed", onAuditChanged);
          if (flushTimer) clearTimeout(flushTimer);
          eventHandlers.forEach((off) => off());
        });
      })
      .catch(() => setConnected(false));

    const heartbeat = setInterval(() => socketRef.current?.emit("heartbeat"), 30_000);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      cleanups.forEach((fn) => fn());
    };
  }, [userId, userName, queryClient]);

  const join = useCallback(
    (room: string) => {
      joinedRooms.current.add(room);
      socketRef.current?.emit("join-room", { room, userId, name: userName });
    },
    [userId, userName],
  );

  const leave = useCallback((room: string) => {
    joinedRooms.current.delete(room);
    socketRef.current?.emit("leave-room", room);
  }, []);

  return (
    <RealtimeContext.Provider value={{ connected, join, leave, socket }}>{children}</RealtimeContext.Provider>
  );
}
