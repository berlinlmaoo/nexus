export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { handleWaInbound } from "@/lib/wa-bot"

// Called by the Hermes bridge when a WA DM arrives. Shared-secret gated (x-wa-secret) — NOT a session,
// the sender is identified by phone inside the handler.
export async function POST(req: NextRequest) {
  const secret = process.env.NEXUS_WA_INBOUND_SECRET
  if (!secret) return NextResponse.json({ error: "inbound not configured" }, { status: 503 })
  if ((req.headers.get("x-wa-secret") || "") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: { chatId?: string; senderId?: string; text?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }) }

  const chatId = typeof body.chatId === "string" ? body.chatId : ""
  const text = typeof body.text === "string" ? body.text : ""
  if (!chatId || !text) return NextResponse.json({ ok: true, skipped: "no content" })

  try {
    await handleWaInbound({ chatId, senderId: body.senderId || chatId, text })
  } catch (e) {
    console.error("[wa-inbound] handler error", e)
  }
  return NextResponse.json({ ok: true })
}
