import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { getSocket } from "./socket";

// Backend bus events (see src/lib/event-bus.ts in the core app) → query invalidation.
const REALTIME_EVENTS = [
  "task-created",
  "task-updated",
  "task-deleted",
  "comment-added",
  "notification",
  "sprint-updated",
  "message-created",
] as const;

// Each event invalidates any query whose key contains one of these terms (substring, case-insensitive).
const INVALIDATION: Record<string, string[]> = {
  "task-created": ["task", "dashboard", "project"],
  "task-updated": ["task", "dashboard", "project"],
  "task-deleted": ["task", "dashboard", "project"],
  "comment-added": ["task", "comment"],
  "notification": ["notification"],
  "sprint-updated": ["sprint", "project", "dashboard"],
  "message-created": ["messages", "conversation"],
};

function keyHasTerm(key: unknown, terms: string[]): boolean {
  const parts = Array.isArray(key) ? key.map((k) => String(k)) : [String(key)];
  return parts.some((p) => terms.some((t) => p.toLowerCase().includes(t)));
}

interface RealtimeContextValue {
  connected: boolean;
  join: (room: string) => void;
  leave: (room: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  join: () => {},
  leave: () => {},
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

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    getSocket()
      .then((socket) => {
        if (cancelled) return;
        socketRef.current = socket;

        const joinAll = () => {
          socket.emit("join-room", { room: `user:${userId}`, userId, name: userName });
          joinedRooms.current.forEach((room) =>
            socket.emit("join-room", { room, userId, name: userName }),
          );
        };
        const onConnect = () => {
          setConnected(true);
          joinAll();
        };
        const onDisconnect = () => setConnected(false);

        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        if (socket.connected) onConnect();

        const eventHandlers = REALTIME_EVENTS.map((evt) => {
          const handler = () => {
            const terms = INVALIDATION[evt] ?? [];
            queryClient.invalidateQueries({ predicate: (q) => keyHasTerm(q.queryKey, terms) });
          };
          socket.on(evt, handler);
          return () => socket.off(evt, handler);
        });

        cleanups.push(() => {
          socket.off("connect", onConnect);
          socket.off("disconnect", onDisconnect);
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
    <RealtimeContext.Provider value={{ connected, join, leave }}>{children}</RealtimeContext.Provider>
  );
}
