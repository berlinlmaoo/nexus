/**
 * Alias for ./realtime-init. Do not delete without checking BOTH front ends.
 *
 * The production web app is Phaethon (apps/nexus-lovable-ui), not the Next.js pages - nginx serves
 * the SPA statically and only proxies /api and /auth here. Phaethon boots the Socket.IO server with
 * `fetch("/api/socket-init")` (src/lib/socket.ts), so renaming this route away left nothing in
 * production calling the bootstrap at all: after every container restart the engine never attached
 * and all web realtime was dead.
 *
 * Engine.IO still swallows this path by prefix once it IS attached, returning 400 - which is why
 * ./realtime-init exists and why the Next.js hook uses that one. It does not matter here: Phaethon
 * ignores the response, and the only call that has to succeed is the first one after a restart,
 * which reaches Next because nothing is attached yet.
 */
import type { NextApiRequest, NextApiResponse } from "next"
import { initializeSocketServer, type NextApiResponseWithSocket } from "./socket"

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  initializeSocketServer(req, res as NextApiResponseWithSocket)
}
