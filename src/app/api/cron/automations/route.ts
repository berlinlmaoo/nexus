export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/cron-auth"
import { runTimeBasedAutomations } from "@/lib/automation-engine"
import { runCronJob } from "@/lib/cron-lock"

/**
 * POST /api/cron/automations (Bearer CRON_SECRET) — one pass of the time-based automations: due date
 * approaching / reached, and schedules (12 Oct 2026). The app already runs this every minute by itself
 * (lib/automation-ticker.ts, started from the root instrumentation.ts); this route is the manual / host-cron handle.
 * Every firing has a dedup key, so calling it on top of the ticker never fires twice.
 */
export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    // One run at a time, cron calls only on the singleton leader (lib/cron-lock.ts).
    return await runCronJob("automations", { fromCron: true }, async () => {
      const result = await runTimeBasedAutomations()
      return NextResponse.json({ ok: true, ...result })
    })
  } catch (error) {
    console.error("cron automations failed", error)
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 })
  }
}
