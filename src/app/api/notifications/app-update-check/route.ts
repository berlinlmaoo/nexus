export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { secretMatches } from "@/lib/cron-auth"
import { remindOutdatedApps } from "@/lib/app-update"

/**
 * POST /api/notifications/app-update-check — daily (root crontab, 10:00 WIB). Pushes "update NEXUS"
 * to anyone whose newest phone runs an older build than the App Store, at most once a week per
 * release. `{ "dryRun": true }` lists who would be reminded without sending; `{ "userIds": [...] }`
 * also reminds those people whatever version they are on.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
    if (!secretMatches(bearer, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    let body: { dryRun?: boolean; userIds?: string[] } | null = null
    try { body = await req.json() } catch { /* no body */ }
    const userIds = Array.isArray(body?.userIds) ? body!.userIds.filter((id) => typeof id === "string" && id.length > 0) : undefined
    const result = await remindOutdatedApps({ dryRun: body?.dryRun === true, userIds })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("app-update-check error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
