export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { syncAttendanceSheet } from "@/lib/attendance-sheet"

/**
 * Live attendance → Google Sheets ("NEXUS · Absensi (live)"). Every minute from the host crontab:
 *   * * * * * /home/debian/nexus/cron/nexus-cron.sh cron/attendance-sheet
 *
 * ?dryRun=1 (or body { dryRun: true }) builds the grid and reports its size, the target tab and a
 * sample of cells without calling Google at all. A Google failure is a 200 with ok:false and the
 * reason, so the cron log shows WHY (a revoked token reads "invalid_grant", needsReauth: true)
 * instead of a bare 500. See src/lib/attendance-sheet.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
    let authorized = Boolean(cronSecret && bearer && bearer === cronSecret)
    if (!authorized) {
      const session = await auth()
      if (session?.user?.id && isBodPlus(await getUserOrgRole(session.user.id))) authorized = true
    }
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    type Body = { dryRun?: boolean }
    let body: Body | null = null
    try { body = (await req.json()) as Body } catch { /* tanpa body */ }
    const q = req.nextUrl.searchParams.get("dryRun")
    const dryRun = body?.dryRun === true || q === "1" || q === "true"

    const result = await syncAttendanceSheet({ dryRun })
    if (!result.ok) console.error("attendance sheet sync not ok:", { stage: result.stage, reason: result.reason })
    return NextResponse.json(result)
  } catch (error) {
    console.error("attendance sheet sync failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
