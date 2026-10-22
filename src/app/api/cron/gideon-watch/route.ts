export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { bi } from "@/lib/notification-text"
import { isCronRequest } from "@/lib/cron-auth"
import { createInAppNotification } from "@/lib/notification-service"
import {
  GIDEON_TICKET_CATEGORIES, recordTicketReviewFailure, REVIEW_CLAIM_MS, reviewSupportTicket, ticketReviewsEnabled, type ReviewOutcome,
} from "@/lib/gideon-ticket"
import {
  ALARM_AFTER_FAILED_ATTEMPTS, formatWib, outageSummary, planTicketRetries, RETRY_CAP_PER_RUN, RETRY_MIN_AGE_MS, shouldAlarmTicket,
  type RetryTicket,
} from "@/lib/gideon-ticket-retry"
import { shimReachable } from "@/lib/gideon-shim-retry"
import { formatAttendanceDateKey } from "@/lib/attendance"
import { GIDEON_EMAIL } from "@/lib/gideon-identity"
import { runCronJob } from "@/lib/cron-lock"

// GIDEON watch. The support chain (NEXUS → shim → Hermes) is called fire-and-forget:
// `void reviewSupportTicket(id).catch(() => {})`. When it breaks — the shim down, Hermes out of
// memory — the ticket simply never gets an answer. Nothing throws where a person can see it, the
// error lands in container logs nobody reads, and the reporter waits on a reply that will never come.
// Silent is the worst failure mode available here, because the whole point of GIDEON is that a ticket
// gets looked at before a BoD has time to.
//
// Measured the way the outage probe is measured: by what people actually experience — a ticket
// sitting unanswered — not by whether a process claims to be up. A shim that is "active" but
// returning errors looks healthy to a health check and broken to a reporter.

// GIDEON normally answers in about 30 seconds (measured across a 13-ticket sweep: 25-35s each). The alarm
// waits ALARM_WAIT_MS (15 minutes, thirty times that) AND for failed retries, so a slow queue never trips it.

// Only tickets whose last message is recent. Older than this is a backlog question for a human, not
// evidence the chain is down, and alarming on it forever would train everyone to ignore the alarm.
const RECENT_DAYS = 7

// Retry before alarming (22 Oct 2026, lib/gideon-ticket-retry.ts). The shim was unreachable for three days while
// NEXUS ran on the failover VPS; a ticket filed then was never answered, and after NEXUS came back this watch pushed
// every BoD every 15 minutes for ~32 hours (the dedupe matched on the message text, which carries the minute count)
// until someone ran /api/gideon/re-review by hand. Now each run first retries the tickets GIDEON owes an answer —
// probe the shim's /health, review at most RETRY_CAP_PER_RUN of them with a per-ticket backoff, and only alarm on a
// ticket whose retries keep failing, saying since when GIDEON has been unreachable. One push per BoD per day.

// How long a run waits for its retries before answering the cron (nexus-cron.sh gives up at 120 s). Reviews still
// running then finish on their own; each holds its ticket's claim and records its own outcome.
const RETRY_BUDGET_MS = 75_000

export async function POST(req: NextRequest) {
  try {
    // CRON_SECRET only (Authorization: Bearer, as cron/nexus-cron.sh sends it). No session fallback.
    if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // One run at a time, cron calls only on the singleton leader (lib/cron-lock.ts).
    return await runCronJob("gideon-watch", { fromCron: true }, async () => {
      // dryRun detects and reports without notifying anyone or retrying anything. There are ten BoD and
      // `push: true` reaches their phones, so proving the DETECTION works must not cost ten people a 5am
      // notification. The notification path itself is not in doubt — the disk alarm has fired it in production.
      let body: { dryRun?: boolean } | null = null
      try {
        body = (await req.json()) as { dryRun?: boolean }
      } catch {
        // no body
      }
      const dryRun = body?.dryRun === true

      const now = Date.now()
      const floor = new Date(now - RECENT_DAYS * 24 * 60 * 60 * 1000)

      // Candidates: a GIDEON-category ticket, still open, whose thread has been quiet past the retry age.
      // Whether GIDEON actually owes an answer is decided below, from the last message's author.
      const candidates = await prisma.complaint.findMany({
        where: {
          category: { in: [...GIDEON_TICKET_CATEGORIES] },
          status: { notIn: ["RESOLVED", "CLOSED"] },
          lastMessageAt: { lt: new Date(now - RETRY_MIN_AGE_MS), gt: floor },
        },
        select: {
          id: true,
          subject: true,
          lastMessageAt: true,
          gideonReviewingAt: true,
          gideonReviewAttempts: true,
          gideonReviewFailedAt: true,
          gideonReviewFailingSince: true,
          gideonReviewError: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { author: { select: { email: true } } },
          },
        },
        orderBy: { lastMessageAt: "asc" },
        take: 50,
      })

      // GIDEON owes an answer exactly when the last word is not its own — the same test its own
      // self-answer guard uses, so this cannot disagree with the thing it is watching. Tickets it already
      // answered are never retried here (re-review stays manual, /api/gideon/re-review).
      const owed = candidates.filter((c) => c.messages[0]?.author?.email !== GIDEON_EMAIL)
      if (owed.length === 0) {
        return NextResponse.json({ ok: true, waiting: 0, notified: 0, level: "ok" })
      }

      // A server that never sends tickets to GIDEON (dev: NEXUS_GIDEON_NO_ATTENDANCE=1) has nothing to retry and
      // nothing to alarm about: an unanswered ticket there is the configuration, not an outage.
      const reviewsOn = ticketReviewsEnabled()
      const shimUp = reviewsOn ? await shimReachable(process.env.GIDEON_CHAT_URL!) : false

      const tickets = new Map<string, RetryTicket & { subject: string }>(owed.map((c) => [c.id, {
        id: c.id,
        subject: c.subject,
        lastMessageAt: c.lastMessageAt,
        attempts: c.gideonReviewAttempts,
        lastFailedAt: c.gideonReviewFailedAt,
        failingSince: c.gideonReviewFailingSince,
        lastError: c.gideonReviewError,
        reviewingAt: c.gideonReviewingAt,
      }]))
      const plan = planTicketRetries([...tickets.values()], { now, shimUp, claimMs: REVIEW_CLAIM_MS }, RETRY_CAP_PER_RUN)

      if (!reviewsOn) {
        return NextResponse.json({ ok: true, level: "disabled", waiting: owed.length, reviewsEnabled: false, ...(dryRun ? { dryRun: true, plan } : {}) })
      }

      // What alarms if the retries below do not answer it: the shim being down this run counts as one more
      // failed attempt for every ticket it kept us from retrying.
      const projected = <T extends RetryTicket>(t: T): T => ({ ...t, attempts: t.attempts + (plan.offline.includes(t.id) ? 1 : 0) })

      if (dryRun) {
        const wouldAlarm = [...tickets.values()].map(projected).filter((t) => shouldAlarmTicket(t, now))
        return NextResponse.json({
          ok: true, dryRun: true, shimUp, waiting: owed.length, plan,
          level: wouldAlarm.length ? "alarm" : "retrying",
          wouldNotify: wouldAlarm.map((t) => ({ id: t.id, subject: t.subject, attempts: t.attempts, failingSince: t.failingSince })),
        })
      }

      // Shim down: nothing is sent; each due ticket records one failed (unreachable) attempt.
      for (const id of plan.offline) {
        await recordTicketReviewFailure(id, "unreachable")
        const t = tickets.get(id)!
        tickets.set(id, { ...t, attempts: t.attempts + 1, lastFailedAt: new Date(now), failingSince: t.failingSince ?? new Date(now), lastError: "unreachable" })
      }

      // Shim up: retry, one at a time (the shim spawns a Hermes process per request). Each review takes its
      // ticket's claim, so a review already running from a ticket route or the re-review sweep is never doubled.
      const results: Record<string, ReviewOutcome> = {}
      const chain = (async () => {
        for (const [i, id] of plan.retry.entries()) {
          if (i) await new Promise((r) => setTimeout(r, 1500))
          results[id] = await reviewSupportTicket(id).catch(() => "failed" as const)
        }
      })()
      await Promise.race([chain, new Promise((r) => setTimeout(r, RETRY_BUDGET_MS))])

      // Re-read what the retries left behind: an answered ticket no longer alarms, a failed one has one more attempt.
      if (plan.retry.length) {
        const after = await prisma.complaint.findMany({
          where: { id: { in: plan.retry } },
          select: { id: true, gideonReviewAttempts: true, gideonReviewFailedAt: true, gideonReviewFailingSince: true, gideonReviewError: true },
        })
        for (const a of after) {
          const t = tickets.get(a.id)!
          if (results[a.id] === "answered") tickets.delete(a.id)
          else tickets.set(a.id, { ...t, attempts: a.gideonReviewAttempts, lastFailedAt: a.gideonReviewFailedAt, failingSince: a.gideonReviewFailingSince, lastError: a.gideonReviewError })
        }
      }

      const alarmed = [...tickets.values()].filter((t) => shouldAlarmTicket(t, now))
      const summary = {
        shimUp,
        waiting: tickets.size,
        retried: plan.retry.length,
        results,
        offline: plan.offline.length,
        deferred: plan.waiting.length,
      }
      if (alarmed.length === 0) {
        return NextResponse.json({ ok: true, level: tickets.size ? "retrying" : "ok", ...summary, notified: 0 })
      }

      const oldest = alarmed.reduce((a, b) => (a.lastMessageAt <= b.lastMessageAt ? a : b))
      const oldestMin = Math.round((now - oldest.lastMessageAt.getTime()) / 60000)
      const outage = outageSummary(alarmed, shimUp)
      const sinceEn = outage.since ? formatWib(outage.since, "en") : null
      const sinceId = outage.since ? formatWib(outage.since, "id") : null
      const headEn = outage.unreachable
        ? `GIDEON unreachable since ${sinceEn ?? "an unknown time"}.`
        : `GIDEON failing since ${sinceEn ?? "an unknown time"} (the shim answers, the review does not).`
      const headId = outage.unreachable
        ? `GIDEON tidak bisa dihubungi sejak ${sinceId ?? "waktu yang tidak diketahui"}.`
        : `GIDEON gagal menjawab sejak ${sinceId ?? "waktu yang tidak diketahui"} (shim menjawab, review-nya gagal).`

      const bod = await prisma.workspaceMember.findMany({
        where: { role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
        select: { userId: true },
        distinct: ["userId"],
      })

      const message =
        `${headId} ${alarmed.length} tiket belum dijawab GIDEON setelah ${ALARM_AFTER_FAILED_ATTEMPTS}+ percobaan ulang. ` +
        `Paling lama: "${oldest.subject.slice(0, 60)}" (${oldestMin} menit). ` +
        "Tiketnya tetap antre dan dicoba ulang otomatis begitu GIDEON bisa dihubungi lagi."

      // One push per BoD per Jakarta day while it stays broken. The old 23 h window matched on the message text,
      // and the text carries the minute count, so it never matched: that was the push every 15 minutes.
      const day = formatAttendanceDateKey(new Date(now))
      let notified = 0
      for (const m of bod) {
        const made = await createInAppNotification({
          userId: m.userId,
          type: "system_gideon",
          ...bi(
            ["GIDEON Support isn't answering", `${headEn} ${alarmed.length} ticket${alarmed.length === 1 ? "" : "s"} still unanswered after ${ALARM_AFTER_FAILED_ATTEMPTS}+ retries. Oldest: "${oldest.subject.slice(0, 60)}" (${oldestMin} min). The tickets stay queued and are retried automatically once GIDEON is reachable again.`],
            ["GIDEON Support tidak menjawab", message]
          ),
          link: "/complaints",
          push: true,
          dedupeKey: `gideon-watch:${m.userId}:${day}`,
        }).catch(() => null)
        if (made) notified += 1
      }

      return NextResponse.json({
        ok: true,
        level: "alarm",
        ...summary,
        alarmed: alarmed.length,
        oldestMinutes: oldestMin,
        unreachableSince: outage.since,
        ids: alarmed.map((c) => c.id),
        notified,
      })
    })
  } catch (error) {
    console.error("gideon watch failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
