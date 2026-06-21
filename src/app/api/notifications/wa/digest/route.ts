export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { sendDigestToAll } from "@/lib/wa-bot"

// Morning WhatsApp digest. Triggered by an external scheduler with the CRON_SECRET bearer (same pattern
// as the attendance crons). GET and POST both work so it's easy to wire to any scheduler.
async function run(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization") || ""
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  // ?userId=<id> → test mode: send only to that user, even if they have no tasks (to preview delivery).
  const userId = new URL(req.url).searchParams.get("userId") || undefined
  const result = await sendDigestToAll({ onlyUserId: userId, includeEmpty: !!userId })
  return NextResponse.json({ ok: true, ...result })
}

export const POST = run
export const GET = run
