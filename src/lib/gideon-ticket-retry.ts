/**
 * When GIDEON Support retries a ticket it could not answer, and when the watch alarms (22 Oct 2026).
 *
 * While NEXUS ran on the failover VPS (19–22 Oct) the shim was unreachable. A "lupa absen" ticket filed then was
 * never answered: the review is fire-and-forget from the ticket routes, it failed once, and nothing ever tried
 * again. After NEXUS came back the ticket stayed unanswered and /api/cron/gideon-watch pushed every BoD every
 * 15 minutes for ~32 hours until someone ran /api/gideon/re-review by hand.
 *
 * Now a failed review leaves the ticket queued (lib/gideon-ticket.ts records the attempt on the ticket) and the watch
 * cron retries it before it considers alarming:
 *  - only tickets whose last word is not GIDEON's (the existing self-answer rule) and that have been quiet for
 *    RETRY_MIN_AGE_MS (the fire-and-forget review is probably still running before that);
 *  - never while another review holds the ticket's claim;
 *  - shim down (its /health does not answer): nothing is sent; the run counts as a failed attempt;
 *  - the last attempt reached the shim and still failed (a model error, an empty reply): back off per ticket,
 *    5 → 10 → 20 → 40 → 60 min, so a broken model is not hammered; an attempt that failed because the shim was
 *    UNREACHABLE is retried as soon as /health answers again (the backoff protects the shim, and it is back);
 *  - at most RETRY_CAP_PER_RUN reviews per run, oldest ticket first.
 * The alarm fires only for a ticket that has waited ALARM_WAIT_MS and failed ALARM_AFTER_FAILED_ATTEMPTS times.
 *
 * No imports on purpose: unit-tested with plain node (gideon-ticket-retry.test.mjs).
 */

export const RETRY_MIN_AGE_MS = 2 * 60_000
export const RETRY_CAP_PER_RUN = 3
export const ALARM_WAIT_MS = 15 * 60_000
export const ALARM_AFTER_FAILED_ATTEMPTS = 2

/** Wait after N failed attempts that reached the shim (index = attempts so far, capped at the last entry). */
export const RETRY_BACKOFF_MS: readonly number[] = [0, 5, 10, 20, 40, 60].map((m) => m * 60_000)

export function retryBackoffMs(attempts: number): number {
  const i = Math.min(Math.max(Math.floor(attempts) || 0, 0), RETRY_BACKOFF_MS.length - 1)
  return RETRY_BACKOFF_MS[i]
}

/** What Complaint.gideonReviewError holds: "unreachable" (never reached / shim down) or "failed: <detail>". */
export type ReviewFailureKind = "unreachable" | "failed"

export function reviewErrorText(kind: ReviewFailureKind, detail?: string | null): string {
  if (kind === "unreachable") return "unreachable"
  return `failed${detail ? `: ${detail}` : ""}`.slice(0, 200)
}

export function reviewFailureKind(error: string | null | undefined): ReviewFailureKind | null {
  if (!error) return null
  return error.startsWith("unreachable") ? "unreachable" : "failed"
}

export type RetryTicket = {
  id: string
  lastMessageAt: Date
  /** Failed review attempts since GIDEON last answered this ticket. */
  attempts: number
  lastFailedAt: Date | null
  /** First failure since GIDEON last answered (the start of this outage, as far as this ticket knows). */
  failingSince: Date | null
  lastError: string | null
  /** Another review's claim (Complaint.gideonReviewingAt). */
  reviewingAt: Date | null
}

export type RetryWaitReason = "fresh" | "in_progress" | "offline" | "backoff" | "cap"
export type RetryDecision = { action: "retry" } | { action: "wait"; reason: RetryWaitReason; until?: Date }

export type RetryContext = { now: number; shimUp: boolean; claimMs: number }

export function decideTicketRetry(t: RetryTicket, ctx: RetryContext): RetryDecision {
  if (ctx.now - t.lastMessageAt.getTime() < RETRY_MIN_AGE_MS) {
    return { action: "wait", reason: "fresh", until: new Date(t.lastMessageAt.getTime() + RETRY_MIN_AGE_MS) }
  }
  if (t.reviewingAt && ctx.now - t.reviewingAt.getTime() < ctx.claimMs) return { action: "wait", reason: "in_progress" }
  if (!ctx.shimUp) return { action: "wait", reason: "offline" }
  if (t.attempts > 0 && reviewFailureKind(t.lastError) === "failed" && t.lastFailedAt) {
    const due = t.lastFailedAt.getTime() + retryBackoffMs(t.attempts)
    if (ctx.now < due) return { action: "wait", reason: "backoff", until: new Date(due) }
  }
  return { action: "retry" }
}

export type RetryPlan = {
  /** Review now, in this order. */
  retry: string[]
  /** Due, but the shim is down: count a failed (unreachable) attempt, send nothing. */
  offline: string[]
  waiting: { id: string; reason: RetryWaitReason; until?: Date }[]
}

/** Tickets oldest first (by last message); the cap keeps a run from fanning out. */
export function planTicketRetries(tickets: RetryTicket[], ctx: RetryContext, cap = RETRY_CAP_PER_RUN): RetryPlan {
  const plan: RetryPlan = { retry: [], offline: [], waiting: [] }
  const ordered = [...tickets].sort((a, b) => a.lastMessageAt.getTime() - b.lastMessageAt.getTime())
  for (const t of ordered) {
    const d = decideTicketRetry(t, ctx)
    if (d.action === "retry") {
      if (plan.retry.length < cap) plan.retry.push(t.id)
      else plan.waiting.push({ id: t.id, reason: "cap" })
    } else if (d.reason === "offline") {
      plan.offline.push(t.id)
    } else {
      plan.waiting.push({ id: t.id, reason: d.reason, ...(d.until ? { until: d.until } : {}) })
    }
  }
  return plan
}

/** Alarm only for a ticket that has waited long enough AND whose retries keep failing. */
export function shouldAlarmTicket(t: Pick<RetryTicket, "lastMessageAt" | "attempts">, now: number): boolean {
  return now - t.lastMessageAt.getTime() >= ALARM_WAIT_MS && t.attempts >= ALARM_AFTER_FAILED_ATTEMPTS
}

/**
 * Since when GIDEON has been unreachable (or failing), for the alarm: the earliest failingSince among the alarmed
 * tickets. `unreachable` is true when the shim is down right now or every alarmed ticket last failed unreachable.
 */
export function outageSummary(
  tickets: Pick<RetryTicket, "failingSince" | "lastError">[],
  shimUp: boolean,
): { since: Date | null; unreachable: boolean } {
  let since: Date | null = null
  for (const t of tickets) if (t.failingSince && (!since || t.failingSince < since)) since = t.failingSince
  const unreachable = !shimUp || (tickets.length > 0 && tickets.every((t) => reviewFailureKind(t.lastError) === "unreachable"))
  return { since, unreachable }
}

/** "22 Okt 14.05 WIB" / "22 Oct 14:05 WIB". */
export function formatWib(d: Date, lang: "en" | "id"): string {
  const s = d.toLocaleString(lang === "id" ? "id-ID" : "en-GB", {
    timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  })
  return `${s.replace(",", "")} WIB`
}
