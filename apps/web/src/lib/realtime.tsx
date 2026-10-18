import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { getSocket } from "./socket";
import { invalidateAuditViews, invalidateProjectViews, patchProjectIcon } from "./invalidate";
import { bindTypingSocket } from "./chat-typing";
import { applyRemoteTask, applyRemoteTaskDeleted, taskWriteInFlight, type RemoteApplyResult } from "./task-cache";

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
// Task events are NOT here any more (realtime bug 5, 13 Oct 2026): they patch the cache from their payload
// (lib/task-cache.ts applyRemoteTask) and refetch only what that could not cover — see TASK_EVENTS below.
const INVALIDATION: Record<string, string[]> = {
  "new-notification": ["notification"],
  "sprint-updated": ["sprint", "dashboard"],
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

/**
 * Task events (task-created/updated/deleted, comment-added, sprint-updated) are folded the same way
 * (perf pass, 12 Oct 2026): a bulk move or an import is dozens of events within a second, and each used to
 * refetch the whole project. Now: one refetch per burst, a quarter second after it ends (at most one second
 * after it starts), and a refetch already in flight is reused rather than cancelled and restarted.
 * A task-updated carrying the task patches its card at once, so the change shows before that refetch.
 */
const TASK_DEBOUNCE_MS = 250;
const TASK_MAX_WAIT_MS = 1_000;
const TASK_EVENTS = new Set(["task-created", "task-updated", "task-deleted", "comment-added"]);
const PING_MAX_WAIT_MS = 2_000;

/**
 * Task lists OTHER than a project's own payload that a task event can change: My Tasks, the dashboard, the
 * Master Calendar (a Folder filter included). Refetched only if on screen (an invalidation refetches active queries
 * only; the rest just goes stale). The project list, folders, pins, views and custom fields are never
 * touched by a task event any more.
 */
function isOtherTaskList(key: readonly unknown[]): boolean {
  if (key[0] === "dashboard") return true;
  return key[0] === "nexus" && (key[1] === "tasks" || key[1] === "dashboard" || key[1] === "calendar-tasks");
}

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
  // Rooms → how many mounted components hold them. Counted (13 Oct 2026): the task popup and the form
  // Responses tab join the same `project:<id>` room as the project page under them, and closing the popup
  // used to LEAVE the room for the whole tab, so the board stopped hearing events until the next reconnect.
  const joinedRooms = useRef<Map<string, number>>(new Map());
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
          joinedRooms.current.forEach((_count, room) =>
            socket.emit("join-room", { room, userId, name: userName }),
          );
        };
        // What the pending workspace/audit pings ask for, flushed as one invalidation per burst.
        const pending = { tree: false, allProjects: false, audit: false, vault: false, submissions: false, legal: false, projectIds: new Set<string>() };
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
          // My Submissions (12 Oct 2026): a request of mine moved, got a handler, a comment or a proof.
          if (pending.submissions) { queryClient.invalidateQueries({ queryKey: ["my-submissions"] }); queryClient.invalidateQueries({ queryKey: ["submission-detail"] }); queryClient.invalidateQueries({ queryKey: ["legal-requests-mine"] }); }
          // The Legal request board (14 Oct 2026; only Legal members' rooms get it): the board, an open request.
          if (pending.legal) { queryClient.invalidateQueries({ queryKey: ["legal", "requests"] }); queryClient.invalidateQueries({ queryKey: ["legal", "request"] }); }
          pending.submissions = false;
          pending.legal = false;
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
          const data = (payload && typeof payload === "object" ? payload : {}) as { kind?: unknown; projectId?: unknown; icon?: unknown };
          // A changed project icon rides along (server since 14 Oct 2026): swap it everywhere now, the
          // debounced refetch below then confirms it.
          if (data.kind === "projects" && typeof data.projectId === "string" && "icon" in data && (typeof data.icon === "string" || data.icon === null)) {
            patchProjectIcon(queryClient, data.projectId, data.icon);
          }
          if (data.kind === "audit") {
            pending.audit = true;
          } else if (data.kind === "submissions") {
            pending.submissions = true;
          } else if (data.kind === "legal") {
            pending.legal = true;
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
            pending.submissions = true;
            pending.legal = true;
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
        // A doc/page changed (block editor, server since 12 Oct 2026): `{ projectId, docId, actorId }` to the
        // project room. Lists and the open page header refetch, folded per burst (a live editing session
        // saves every second or two). The body itself syncs through its own live room.
        const docBurst = { ids: new Set<string>(), projects: new Set<string>(), timer: null as ReturnType<typeof setTimeout> | null };
        const onDocChanged = (payload?: unknown) => {
          const data = (payload && typeof payload === "object" ? payload : {}) as { docId?: unknown; projectId?: unknown };
          if (typeof data.docId === "string") docBurst.ids.add(data.docId);
          if (typeof data.projectId === "string") docBurst.projects.add(data.projectId);
          if (docBurst.timer) return;
          docBurst.timer = setTimeout(() => {
            docBurst.timer = null;
            queryClient.invalidateQueries({ queryKey: ["nexus", "docs"] });
            docBurst.ids.forEach((id) => queryClient.invalidateQueries({ queryKey: ["nexus", "doc", id] }));
            docBurst.projects.forEach((id) => queryClient.invalidateQueries({ queryKey: ["nexus", "project-docs", id] }));
            docBurst.ids.clear();
            docBurst.projects.clear();
          }, 1500);
        };
        socket.on("doc-changed", onDocChanged);
        cleanups.push(() => { socket.off("doc-changed", onDocChanged); if (docBurst.timer) clearTimeout(docBurst.timer); });
        if (socket.connected) onConnect();

        // What task events could not patch, refetched once per burst: exact project payloads, the flat lists
        // of the projects touched (only if on screen), subtask lists, comment threads, other task lists.
        const taskBurst = {
          projects: new Set<string>(), flat: new Set<string>(), parents: new Set<string>(), comments: new Set<string>(),
          others: false, sprint: false,
          timer: null as ReturnType<typeof setTimeout> | null, startedAt: 0, heldSince: 0,
        };
        const flushTasks = () => {
          if (taskBurst.timer) clearTimeout(taskBurst.timer);
          // A batch move of this tab is still running (multi-drag): its events are its own echo, and a
          // refetch now would show the half-done state. Wait for it (its settle refetches), at most 15 s.
          const now = Date.now();
          if (taskWriteInFlight() && (!taskBurst.heldSince || now - taskBurst.heldSince < 15_000)) {
            if (!taskBurst.heldSince) taskBurst.heldSince = now;
            taskBurst.timer = setTimeout(flushTasks, TASK_DEBOUNCE_MS);
            return;
          }
          taskBurst.heldSince = 0;
          taskBurst.timer = null;
          taskBurst.startedAt = 0;
          const opts = { cancelRefetch: false } as const;
          taskBurst.projects.forEach((id) => void queryClient.invalidateQueries({ queryKey: ["nexus", "project", id], exact: true }, opts));
          taskBurst.flat.forEach((id) => void queryClient.invalidateQueries({ queryKey: ["nexus", "project-calendar-tasks", id], exact: true }, opts));
          if (taskBurst.parents.size) {
            void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "nexus" && q.queryKey[1] === "project-calendar-tasks" && q.queryKey[3] === "subtasks" }, opts);
            taskBurst.parents.forEach((id) => void queryClient.invalidateQueries({ queryKey: ["task", id] }, opts));
          }
          if (taskBurst.others) void queryClient.invalidateQueries({ predicate: (q) => isOtherTaskList(q.queryKey) }, opts);
          taskBurst.projects.clear();
          taskBurst.flat.clear();
          taskBurst.parents.clear();
          taskBurst.others = false;
        };
        const scheduleTasks = () => {
          const now = Date.now();
          if (!taskBurst.startedAt) taskBurst.startedAt = now;
          if (taskBurst.timer) clearTimeout(taskBurst.timer);
          taskBurst.timer = setTimeout(flushTasks, Math.max(0, Math.min(TASK_DEBOUNCE_MS, taskBurst.startedAt + TASK_MAX_WAIT_MS - now)));
        };
        const queueRefetch = (r: RemoteApplyResult, flat: boolean) => {
          r.refetchProjects.forEach((id) => taskBurst.projects.add(id));
          if (flat) r.touchedProjects.forEach((id) => taskBurst.flat.add(id));
          r.parentIds.forEach((id) => taskBurst.parents.add(id));
          taskBurst.others = true;
          scheduleTasks();
        };
        // A comment: the open thread and popup of that task refetch at once (folded per 60 ms), nothing else.
        let commentTimer: ReturnType<typeof setTimeout> | null = null;
        const onTaskEvent = (evt: string, payload: unknown) => {
          const data = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
          if (evt === "comment-added") {
            if (typeof data.taskId !== "string") return;
            taskBurst.comments.add(data.taskId);
            if (!commentTimer) commentTimer = setTimeout(() => {
              commentTimer = null;
              taskBurst.comments.forEach((id) => {
                void queryClient.invalidateQueries({ queryKey: ["task-comments", id] });
                void queryClient.invalidateQueries({ queryKey: ["task", id] });
              });
              taskBurst.comments.clear();
            }, 60);
            return;
          }
          if (evt === "task-deleted") {
            if (typeof data.taskId !== "string") return;
            const r = applyRemoteTaskDeleted(queryClient, data.taskId);
            // A deleted task's open popup finds out (404) instead of showing a ghost.
            void queryClient.invalidateQueries({ queryKey: ["task", data.taskId] });
            queueRefetch(r, false);
            return;
          }
          if (typeof data.id !== "string") return;
          const r = applyRemoteTask(queryClient, evt === "task-created" ? "created" : "updated", data as Record<string, unknown> & { id: string });
          // An open popup of this task re-reads its detail (section, activity, fields the card payload lacks):
          // one request, and only in tabs that have that popup open.
          if (evt === "task-updated") {
            void queryClient.invalidateQueries({ queryKey: ["task", data.id] });
            // Its property rows (custom fields) are their own query (QA 16 Oct 2026: a field set elsewhere never showed).
            void queryClient.invalidateQueries({ queryKey: ["task-cf", data.id] });
          }
          // A new card may belong in a flat list (Calendar, Sheet task column) the payload can't place: refetch
          // those if on screen. An update was patched into them already.
          queueRefetch(r, evt === "task-created");
        };
        cleanups.push(() => { if (taskBurst.timer) clearTimeout(taskBurst.timer); if (commentTimer) clearTimeout(commentTimer); });

        // A form got a response (server since 13 Oct 2026, realtime bug 6): its Responses tab and the forms
        // list (response counts) refetch, if on screen.
        const onFormResponses = (payload?: unknown) => {
          const data = (payload && typeof payload === "object" ? payload : {}) as { formId?: unknown };
          if (typeof data.formId === "string") void queryClient.invalidateQueries({ queryKey: ["nexus", "form-responses", data.formId] });
          void queryClient.invalidateQueries({ queryKey: ["nexus", "forms"] });
        };
        socket.on("form-responses-changed", onFormResponses);
        cleanups.push(() => socket.off("form-responses-changed", onFormResponses));

        // Taken out of a project (or sheet) room because access to the project ended (server since 13 Oct 2026):
        // the open project refetches and shows the no-access state instead of silently going quiet; the
        // project tree drops it.
        const onJoinDenied = (payload?: unknown) => {
          const data = (payload && typeof payload === "object" ? payload : {}) as { room?: unknown; reason?: unknown };
          if (data.reason !== "revoked" || typeof data.room !== "string") return;
          if (data.room.startsWith("project:")) void queryClient.invalidateQueries({ queryKey: ["nexus", "project", data.room.slice("project:".length)] });
          if (data.room.startsWith("sheet:")) void queryClient.invalidateQueries({ queryKey: ["nexus", "sheet", data.room.slice("sheet:".length)] });
          pending.tree = true;
          schedulePings();
        };
        socket.on("join-denied", onJoinDenied);
        cleanups.push(() => socket.off("join-denied", onJoinDenied));

        const eventHandlers = REALTIME_EVENTS.map((evt) => {
          const handler = (payload?: unknown) => {
            const terms = [...(INVALIDATION[evt] ?? [])];
            if (TASK_EVENTS.has(evt)) {
              if (debug) console.debug("[realtime]", evt);
              onTaskEvent(evt, payload);
              return;
            }
            if (evt === "sprint-updated") {
              if (debug) console.debug("[realtime]", evt);
              void queryClient.invalidateQueries({ predicate: (q) => keyHasTerm(q.queryKey, terms) }, { cancelRefetch: false });
              return;
            }
            const data = (payload && typeof payload === "object" ? payload : {}) as { type?: unknown; conversationId?: unknown; reason?: unknown; kind?: unknown };
            if (debug) console.debug("[realtime]", evt, { conversationId: data.conversationId, reason: data.reason, kind: data.kind });
            // Servers before 8 Oct 2026 send no conversation-updated, but do write a bell
            // notification (type MESSAGE / MESSAGE_MENTION) for every chat message — so that is
            // the signal that some other chat moved.
            if (evt === "new-notification" && typeof data.type === "string" && data.type.startsWith("MESSAGE")) {
              terms.push("conversation");
            }
            queryClient.invalidateQueries({ predicate: (q) => keyHasTerm(q.queryKey, terms) });
            // A deleted group (server since 9 Oct 2026): out of every list at once, its cached thread and
            // info dropped. An open thread closes itself (routes/_app/messages.tsx).
            if (evt === "conversation-updated" && data.reason === "deleted" && typeof data.conversationId === "string") {
              const gone = data.conversationId;
              queryClient.setQueryData<{ conversations?: Array<{ id: string }> }>(["conversations"], (cur) =>
                cur && Array.isArray(cur.conversations) ? { ...cur, conversations: cur.conversations.filter((c) => c.id !== gone) } : cur);
              queryClient.removeQueries({ queryKey: ["chat-info", gone] });
              queryClient.removeQueries({ queryKey: ["messages", gone] });
              void queryClient.refetchQueries({ queryKey: ["conversations"], type: "all" });
            }
            // The thread of that room too, in case it's on screen but its room join was refused.
            // With `after=` this is a near-empty request when the room event already delivered it.
            else if (evt === "conversation-updated" && typeof data.conversationId === "string") {
              queryClient.invalidateQueries({ queryKey: ["messages", data.conversationId] });
              // Someone joined, left, was added or removed, or the group was renamed — possibly me, in a
              // room this tab has never listed. Refetch the list even when no screen is showing it (an
              // invalidation alone only refetches what is on screen), and the room's info drawer.
              if (data.reason === "membership") {
                void queryClient.refetchQueries({ queryKey: ["conversations"], type: "all" });
                queryClient.invalidateQueries({ queryKey: ["chat-info", data.conversationId] });
              }
            }
            // A system line ("Budi added Mira") in an open room: its member list changed too.
            if (evt === "message-created" && data.kind === "SYSTEM" && typeof data.conversationId === "string") {
              queryClient.invalidateQueries({ queryKey: ["chat-info", data.conversationId] });
            }
          };
          socket.on(evt, handler);
          return () => socket.off(evt, handler);
        });

        // "… is typing" (chat-typing.ts): its own store, read by the thread, its header and the list.
        cleanups.push(bindTypingSocket(socket, userId));

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
      joinedRooms.current.set(room, (joinedRooms.current.get(room) ?? 0) + 1);
      socketRef.current?.emit("join-room", { room, userId, name: userName });
    },
    [userId, userName],
  );

  const leave = useCallback((room: string) => {
    const left = (joinedRooms.current.get(room) ?? 1) - 1;
    if (left > 0) { joinedRooms.current.set(room, left); return; }
    joinedRooms.current.delete(room);
    socketRef.current?.emit("leave-room", room);
  }, []);

  return (
    <RealtimeContext.Provider value={{ connected, join, leave, socket }}>{children}</RealtimeContext.Provider>
  );
}
