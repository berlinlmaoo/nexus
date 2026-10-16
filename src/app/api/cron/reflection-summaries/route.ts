export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { isCronRequest } from "@/lib/cron-auth"
import { previousMonthKey, isMonthKey, summarizeReflectionMonth } from "@/lib/reflection-summaries"
import { acquireCronLock, CRON_SKIPPED_NOT_LEADER, CRON_SKIPPED_RUNNING, waitForLeader } from "@/lib/cron-lock"

/**
 * Monthly: GIDEON writes last month's reflection summary for everyone who wrote reflections.
 *
 * Runs on the 1st (crontab on the server host, 02:10 WIB). The work is started and the response returned
 * at once: the cron wrapper gives curl 120 s and one GIDEON call can take longer than that, so
 * waiting here would only ever log a timeout. Progress goes to the app log, one line per person.
 * `?month=YYYY-MM` overrides the month for a manual re-run.
 */
export async function POST(req: NextRequest) {
  // CRON_SECRET only (Authorization: Bearer, as cron/nexus-cron.sh sends it). No session fallback.
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // One run at a time, only on the singleton leader (lib/cron-lock.ts). The run outlives this response,
  // so the lock is held by the background work below and released when it ends.
  if (!(await waitForLeader())) return NextResponse.json(CRON_SKIPPED_NOT_LEADER)
  const release = await acquireCronLock("reflection-summaries")
  if (!release) return NextResponse.json(CRON_SKIPPED_RUNNING)

  const override = req.nextUrl.searchParams.get("month")
  const month = isMonthKey(override) ? override : previousMonthKey()
  const [y, m] = month.split("-").map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1)), end = new Date(Date.UTC(y, m, 1))
  const people = await prisma.attendanceRecord.groupBy({
    by: ["userId", "workspaceId"],
    where: { attendanceDate: { gte: start, lt: end }, checkOutReflection: { not: null } },
  }).catch(async (err) => {
    await release()
    throw err
  })

  void (async () => {
    let done = 0, skipped = 0, failed = 0
    for (const p of people) {
      try {
        const r = await summarizeReflectionMonth(p.userId, p.workspaceId, month)
        if (r.cached) skipped++
        else if (r.monthly) done++
        else failed++
      } catch (err) {
        failed++
        console.error("reflection-summaries cron: person failed", { userId: p.userId, month, err })
      }
    }
    console.log(`reflection-summaries cron: ${month} — written ${done}, already current ${skipped}, failed ${failed}`)
  })().finally(() => release())

  return NextResponse.json({ ok: true, month, people: people.length, started: true }, { status: 202 })
}
