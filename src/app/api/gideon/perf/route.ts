export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildPerfSummary, canSeePerf } from "@/lib/gideon-perf"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/gideon/perf")

/**
 * GET /api/gideon/perf → PerfSummary (lib/gideon-perf.ts): Control Room › GIDEON › Performance (18 Oct 2026).
 * BoD / One Above All of the company workspace only (403 for everyone else). Numbers only, never questions.
 * Live updates: join the socket room `gideon:perf` and listen for `gideon-perf` (docs/internal/gideon-performance-native.md).
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await canSeePerf(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  try {
    const summary = await buildPerfSummary()
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    log.error("summary failed", { error: String(error) })
    return NextResponse.json({ error: "Couldn't load GIDEON performance." }, { status: 500 })
  }
}
