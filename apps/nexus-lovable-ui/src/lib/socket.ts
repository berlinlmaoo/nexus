import { io, type Socket } from "socket.io-client";

// Singleton Socket.IO connection to the NEXUS backend (proxied to :3020 in dev).
// Mirrors the backend contract: hit /api/socket-init to boot the server, then
// connect on path "/api/socket". Rooms are joined via the "join-room" event.

let socket: Socket | null = null;
let initPromise: Promise<void> | null = null;

function ensureServer() {
  // Best-effort boot: the backend lazily starts the Socket.IO server on this
  // route, but it may already be running. Either way we proceed to connect —
  // the io() client retries on its own if the server isn't reachable yet.
  if (!initPromise) {
    initPromise = fetch("/api/socket-init", { credentials: "include" })
      .then(() => undefined)
      .catch(() => undefined);
  }
  return initPromise;
}

export async function getSocket(): Promise<Socket> {
  await ensureServer();
  if (!socket) {
    socket = io({
      path: "/api/socket",
      transports: ["polling", "websocket"],
      upgrade: true,
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  initPromise = null;
}
