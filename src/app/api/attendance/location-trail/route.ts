export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { advanceOutsideClock, ingestTrailPoints } from "@/lib/attendance-location"
import { MAX_POINTS_PER_REQUEST, parseTrailPoints } from "@/lib/attendance-outside"

/**
 * The phone's location trail while checked in (app only; see lib/attendance-location.ts).
 *
 * Body: { recordId?: string, points: { lat, lng, accuracy?, at: ISO, event?: "exit"|"enter"|"point" }[] }
 * (at most 200 points). Idempotent on (user, at): the app may resend a batch whose reply it lost.
 *
 * Reply: { ok, tracking, outsideSince, stage, nextAt } (+ accepted/ignored counts). `tracking: false`
 * = no open record, or this person/record is not tracked (BoD, Custom/Mobile attendance, a web or
 * BoD-entered check-in) — the app stops tracking. Unusable points are skipped, never a 400, so one bad
 * fix cannot wedge the app's queue; only a malformed body or more than 200 points is refused.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    type TrailBody = { recordId?: unknown; points?: unknown }
    let body: TrailBody | null = null
    try {
      body = (await request.json()) as TrailBody
    } catch {
      body = null
    }
    if (!body || typeof body !== "object" || !Array.isArray(body.points)) {
      return NextResponse.json({ error: "Body must be { recordId?, points: [...] }.", code: "INVALID_BODY" }, { status: 400 })
    }
    if (body.points.length > MAX_POINTS_PER_REQUEST) {
      return NextResponse.json(
        { error: `At most ${MAX_POINTS_PER_REQUEST} points per request.`, code: "TOO_MANY_POINTS", max: MAX_POINTS_PER_REQUEST },
        { status: 400 },
      )
    }
    const recordId = typeof body.recordId === "string" && body.recordId.trim() ? body.recordId.trim() : null
    const { points, dropped } = parseTrailPoints(body.points)

    const now = new Date()
    const ingest = await ingestTrailPoints(session.user.id, recordId, points, now)
    if (!ingest.tracking || !ingest.recordId) {
      const auto = ingest.record?.outsideStage === "auto_checked_out"
      return NextResponse.json({
        ok: true,
        tracking: false,
        outsideSince: auto ? ingest.record?.outsideSince?.toISOString() ?? null : null,
        stage: auto ? "auto_checked_out" : "inside",
        nextAt: null,
        accepted: 0,
        ignored: ingest.ignored + dropped,
      })
    }

    // The same tick the per-minute cron runs — so a batch that proves 2 h 30 outside is answered with
    // the automatic check-out rather than a stage that is already out of date.
    const clock = await advanceOutsideClock(ingest.recordId, { now })
    return NextResponse.json({
      ok: true,
      tracking: clock.stage !== "auto_checked_out" && clock.tracking,
      outsideSince: clock.outsideSince,
      stage: clock.stage,
      nextAt: clock.nextAt,
      accepted: ingest.accepted,
      ignored: ingest.ignored + dropped,
    })
  } catch (error) {
    console.error("Error storing location trail:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
