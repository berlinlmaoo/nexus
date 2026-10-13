import { io, type Socket } from "socket.io-client";

// Singleton Socket.IO connection to the NEXUS backend (proxied to :3020 in dev).
// Mirrors the backend contract: hit /api/realtime-init to boot the server, then
// connect on path "/api/socket". Rooms are joined via the "join-room" event.

let socket: Socket | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Ask the backend to start its Socket.IO server (it does so lazily, on this route).
 *
 * The route is /api/realtime-init, NOT /api/socket-init: Engine.IO is mounted at "/api/socket" and
 * matches by prefix, so it swallowed "/api/socket-init" and answered 400 "Transport unknown" from the
 * second call on (pages/api/realtime-init.ts). Best-effort: the io() client retries on its own.
 */
function bootServer(): Promise<void> {
  return fetch("/api/realtime-init", { credentials: "include" })
    .then(() => undefined)
    .catch(() => undefined);
}

function ensureServer() {
  if (!initPromise) initPromise = bootServer();
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
    // A tab left open across a deploy reconnects to a fresh server process whose Socket.IO server has
    // not been started yet: boot it again before every attempt, as the iOS app does.
    socket.io.on("reconnect_attempt", () => { void bootServer(); });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  initPromise = null;
}
