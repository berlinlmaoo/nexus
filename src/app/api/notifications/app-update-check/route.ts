export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { remindOutdatedApps } from "@/lib/app-update"

/**
 * POST /api/notifications/app-update-check — daily (root crontab, 10:00 WIB). Pushes "update NEXUS"
 * to anyone whose newest phone runs an older build than the App Store, at most once a week per
 * release. `{ "dryRun": true }` lists who would be reminded without sending.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
    if (bearer !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    let body: { dryRun?: boolean } | null = null
    try { body = await req.json() } catch { /* no body */ }
    const result = await remindOutdatedApps({ dryRun: body?.dryRun === true })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("app-update-check error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
