export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { isCronRequest } from "@/lib/cron-auth"
import { createInAppNotification } from "@/lib/notification-service"
import { GIDEON_TICKET_CATEGORIES } from "@/lib/gideon-ticket"
import { GIDEON_EMAIL } from "@/lib/gideon-identity"

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
const WAIT_MINUTES = 15

// GIDEON normally answers in about 30 seconds (measured across a 13-ticket sweep: 25-35s each).
// 15 minutes is thirty times that — long enough that a slow queue or one retry never trips it.
const RECENT_DAYS = 7

// Only tickets whose last message is recent. Older than this is a backlog question for a human, not
// evidence the chain is down, and alarming on it forever would train everyone to ignore the alarm.

export async function POST(req: NextRequest) {
  try {
    // CRON_SECRET only (Authorization: Bearer, as cron/nexus-cron.sh sends it). No session fallback.
    if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // dryRun detects and reports without notifying anyone. There are ten BoD and `push: true` reaches
    // their phones, so proving the DETECTION works must not cost ten people a 5am notification. The
    // notification path itself is not in doubt — the disk alarm has fired it in production.
    let body: { dryRun?: boolean } | null = null
    try {
      body = (await req.json()) as { dryRun?: boolean }
    } catch {
      // no body
    }
    const dryRun = body?.dryRun === true

    const now = Date.now()
    const cutoff = new Date(now - WAIT_MINUTES * 60 * 1000)
    const floor = new Date(now - RECENT_DAYS * 24 * 60 * 60 * 1000)

    // Candidates: a GIDEON-category ticket, still open, whose thread has been quiet longer than the
    // wait. Whether GIDEON actually owes an answer is decided below, from the last message's author.
    const candidates = await prisma.complaint.findMany({
      where: {
        category: { in: [...GIDEON_TICKET_CATEGORIES] },
        status: { notIn: ["RESOLVED", "CLOSED"] },
        lastMessageAt: { lt: cutoff, gt: floor },
      },
      select: {
        id: true,
        subject: true,
        lastMessageAt: true,
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
    // self-answer guard uses, so this cannot disagree with the thing it is watching.
    const waiting = candidates.filter((c) => c.messages[0]?.author?.email !== GIDEON_EMAIL)

    if (waiting.length === 0) {
      return NextResponse.json({ ok: true, waiting: 0, notified: 0, level: "ok" })
    }

    const oldest = waiting[0]
    const oldestMin = Math.round((now - oldest.lastMessageAt.getTime()) / 60000)

    if (dryRun) {
      return NextResponse.json({
        ok: true, dryRun: true, level: "alarm", waiting: waiting.length, oldestMinutes: oldestMin,
        wouldNotify: waiting.map((c) => ({ id: c.id, subject: c.subject })),
      })
    }

    const bod = await prisma.workspaceMember.findMany({
      where: { role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
      select: { userId: true },
      distinct: ["userId"],
    })

    const message =
      `${waiting.length} tiket nunggu jawaban GIDEON lebih dari ${WAIT_MINUTES} menit. ` +
      `Paling lama: "${oldest.subject.slice(0, 60)}" (${oldestMin} menit). ` +
      "Biasanya GIDEON jawab dalam setengah menit, jadi ini tandanya rantai shim/Hermes lagi mati atau nolak."

    let notified = 0
    for (const m of bod) {
      // Same dedupe as the disk alarm: one per day per BoD while it stays broken. A watchdog that
      // fires every 15 minutes is how a real alarm gets muted.
      const made = await createInAppNotification({
        userId: m.userId,
        type: "system_gideon",
        title: "GIDEON Support tidak menjawab",
        message,
        link: "/complaints",
        push: true,
        dedupeWindowMs: 23 * 60 * 60 * 1000,
      }).catch(() => null)
      if (made) notified += 1
    }

    return NextResponse.json({
      ok: true,
      level: "alarm",
      waiting: waiting.length,
      oldestMinutes: oldestMin,
      ids: waiting.map((c) => c.id),
      notified,
    })
  } catch (error) {
    console.error("gideon watch failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
