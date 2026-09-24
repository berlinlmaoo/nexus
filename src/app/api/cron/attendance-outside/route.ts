export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { advanceOutsideClock, recordsOutsideNow, type ClockResult } from "@/lib/attendance-location"

/**
 * The outside-the-office clock. Every minute, from the nexus-cron-menit systemd service:
 *   ExecStart=/usr/bin/env NEXUS_CRON_QUIET=1 /home/debian/nexus/cron/nexus-cron.sh cron/attendance-outside
 *
 * For every open record that is outside right now: 1 h 30 → reminder, 2 h → warning, 2 h 30 (and at
 * least 30 min after the warning) → automatic offsite check-out. Each once per outside episode — the
 * stage is stored on the record and moved with a conditional write. The clock runs on server time, so
 * a phone that stopped reporting while outside is still counted as outside (`stale` in the result and
 * in the pushes' data). See lib/attendance-outside.ts for the rules.
 *
 * ?dryRun=1 (or body { dryRun: true }) lists what each record would do now and writes/sends nothing.
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

    type CronBody = { dryRun?: boolean }
    let body: CronBody | null = null
    try {
      body = (await req.json()) as CronBody
    } catch {
      /* tanpa body */
    }
    const q = req.nextUrl.searchParams.get("dryRun")
    const dryRun = body?.dryRun === true || q === "1" || q === "true"

    const now = new Date()
    const ids = await recordsOutsideNow()
    const results: ClockResult[] = []
    const errors: { recordId: string; error: string }[] = []
    // One at a time: a handful of records a minute, and each may push to APNs.
    for (const id of ids) {
      try {
        results.push(await advanceOutsideClock(id, { now, dryRun }))
      } catch (error) {
        errors.push({ recordId: id, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (errors.length) console.error("attendance-outside: some records failed", errors.slice(0, 5))

    const fired = results.filter((r) => r.fired)
    return NextResponse.json({
      // false only when something failed, so NEXUS_CRON_QUIET logs the run that needs looking at.
      ok: errors.length === 0,
      dryRun,
      now: now.toISOString(),
      outside: ids.length,
      due: results.filter((r) => r.due).length,
      fired: fired.map((r) => ({ recordId: r.recordId, name: r.name, stage: r.stage, stale: r.stale })),
      ...(dryRun ? { records: results } : {}),
      errors,
    })
  } catch (error) {
    console.error("Error running the attendance-outside clock:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
