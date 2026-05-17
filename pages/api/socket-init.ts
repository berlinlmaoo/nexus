import type { NextApiRequest, NextApiResponse } from "next"
import { initializeSocketServer, type NextApiResponseWithSocket } from "./socket"

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  initializeSocketServer(req, res as NextApiResponseWithSocket)
}
