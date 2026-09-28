export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { isCronRequest } from "@/lib/cron-auth"
import { attendancePeriodKey } from "@/lib/attendance"
import { periodBounds } from "@/lib/day-off-bonus"
import { countFaces } from "@/lib/face-check"

// Face check on attendance selfies (lib/face-check.ts). Every 5 minutes (crontab on nexus-prod,
// cron/nexus-cron.sh): the selfies not checked yet, newest first, at most LIMIT records a run, from
// the start of the PREVIOUS 28→27 period — which is also the backfill: the first runs after this
// shipped worked through both periods, a couple of hundred records at a time.
//
// It only writes the face counts. Nothing is sent to anyone: a selfie with no face shows up in the
// BoD's Absen Monitor (level NOFACE), and whether to warn the person is theirs to decide.
//
// Written with raw SQL on purpose: a Prisma update would bump AttendanceRecord.updatedAt, which the
// live-location code reads as the moment a closed record was closed.

const LIMIT = 200
const CONCURRENCY = 4
// Stay well inside the caller's 120 s curl timeout; what is left over is the next run's.
const BUDGET_MS = 80_000

function prevPeriodKey(key: string) {
  const [y, m] = key.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export async function POST(req: NextRequest) {
  try {
    // CRON_SECRET only (Authorization: Bearer). No session fallback.
    if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const since = periodBounds(prevPeriodKey(attendancePeriodKey())).start
    const records = await prisma.attendanceRecord.findMany({
      where: {
        attendanceDate: { gte: since },
        OR: [
          { checkInPhotoUrl: { not: null }, checkInFaceCount: null },
          { checkOutPhotoUrl: { not: null }, checkOutFaceCount: null },
        ],
      },
      select: { id: true, checkInPhotoUrl: true, checkInFaceCount: true, checkOutPhotoUrl: true, checkOutFaceCount: true },
      orderBy: [{ attendanceDate: "desc" }, { createdAt: "desc" }],
      take: LIMIT,
    })

    const started = Date.now()
    let checked = 0, noFace = 0, failed = 0, skipped = 0
    let next = 0
    const worker = async () => {
      while (next < records.length) {
        const r = records[next++]
        if (Date.now() - started > BUDGET_MS) { skipped++; continue }
        const inCount = r.checkInPhotoUrl && r.checkInFaceCount == null ? await countFaces(r.checkInPhotoUrl) : null
        const outCount = r.checkOutPhotoUrl && r.checkOutFaceCount == null ? await countFaces(r.checkOutPhotoUrl) : null
        const wantedIn = Boolean(r.checkInPhotoUrl && r.checkInFaceCount == null)
        const wantedOut = Boolean(r.checkOutPhotoUrl && r.checkOutFaceCount == null)
        if ((wantedIn && inCount == null) || (wantedOut && outCount == null)) failed++
        if (inCount == null && outCount == null) continue
        if (inCount === 0 || outCount === 0) noFace++
        await prisma.$executeRaw`
          UPDATE "AttendanceRecord"
          SET "checkInFaceCount" = COALESCE(${inCount}::int, "checkInFaceCount"),
              "checkOutFaceCount" = COALESCE(${outCount}::int, "checkOutFaceCount"),
              "faceCheckedAt" = NOW()
          WHERE "id" = ${r.id}`
        checked++
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    // ok:false when the detector answered nothing at all: the quiet cron caller then logs the run,
    // which is how a dead sidecar gets noticed.
    const ok = records.length === 0 || checked > 0 || failed === 0
    return NextResponse.json({ ok, candidates: records.length, checked, noFace, failed, skipped, ms: Date.now() - started })
  } catch (error) {
    console.error("attendance face check failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
