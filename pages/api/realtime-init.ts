/**
 * Boots the Socket.IO server. Deliberately NOT named "socket-init".
 *
 * The engine in ./socket.ts is mounted at path "/api/socket" with `addTrailingSlash: false`, and
 * Engine.IO matches its path by PREFIX. That made it swallow "/api/socket-init" - this bootstrap -
 * the moment it attached: the first caller got through, and every caller after it received
 * `{"code":0,"message":"Transport unknown"}` with HTTP 400. `ensureSocketServer()` in
 * src/hooks/use-socket.ts throws on a non-ok response, so from the second page load onwards the
 * client never opened a socket at all. Realtime looked implemented and was, in practice, dead.
 *
 * Keeping this route outside the "/api/socket" prefix is the whole fix.
 */
import type { NextApiRequest, NextApiResponse } from "next"
import { initializeSocketServer, type NextApiResponseWithSocket } from "./socket"

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  initializeSocketServer(req, res as NextApiResponseWithSocket)
}
