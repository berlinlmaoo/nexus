export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { evaluateAlerts, ingestAuthorized, parseIngest, perfWatchers, pruneGpuSamples, storeIngest } from "@/lib/gideon-perf"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/gideon/perf/ingest")

/**
 * POST /api/gideon/perf/ingest — the office GPU host's exporter (deploy/gideon-perf/gideon-perf-exporter.py),
 * `Authorization: Bearer $GIDEON_PERF_INGEST_SECRET`. Body: { v: 1, gpu, engine, whisper, events } (see the
 * exporter). Reply: { ok, next } — seconds until the next sample: 5 while somebody has the panel open, else 60.
 * No secret configured on the server = 404 (the endpoint does not exist for anyone).
 */
export async function POST(req: NextRequest) {
  if (!process.env.GIDEON_PERF_INGEST_SECRET) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!ingestAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const len = Number(req.headers.get("content-length") || 0)
  if (len > 256_000) return NextResponse.json({ error: "Too large" }, { status: 413 })
  const body = await req.json().catch(() => null)
  const parsed = parseIngest(body)
  if (!parsed) return NextResponse.json({ error: "Bad payload" }, { status: 400 })
  try {
    await storeIngest(parsed.live, parsed.events)
    const alerts = await evaluateAlerts(parsed.live)
    void pruneGpuSamples()
    return NextResponse.json({ ok: true, next: perfWatchers() > 0 ? 5 : 60, active: alerts.filter((a) => a.active).map((a) => a.key) })
  } catch (error) {
    log.error("ingest failed", { error: String(error) })
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 })
  }
}
