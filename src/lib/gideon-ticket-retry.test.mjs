// node --experimental-strip-types src/lib/gideon-ticket-retry.test.mjs
import assert from "node:assert/strict"
import {
  RETRY_MIN_AGE_MS, RETRY_CAP_PER_RUN, ALARM_WAIT_MS, ALARM_AFTER_FAILED_ATTEMPTS, retryBackoffMs, reviewErrorText, reviewFailureKind,
  decideTicketRetry, planTicketRetries, shouldAlarmTicket, outageSummary, formatWib,
} from "./gideon-ticket-retry.ts"

const MIN = 60_000
const NOW = Date.parse("2026-10-22T07:00:00Z") // 14:00 WIB
const CLAIM = 6 * MIN
const ago = (m) => new Date(NOW - m * MIN)
const ticket = (o = {}) => ({ id: "t", lastMessageAt: ago(30), attempts: 0, lastFailedAt: null, failingSince: null, lastError: null, reviewingAt: null, ...o })
const up = { now: NOW, shimUp: true, claimMs: CLAIM }
const down = { now: NOW, shimUp: false, claimMs: CLAIM }

// ── constants the cron and the alarm text rely on ──
assert.equal(RETRY_MIN_AGE_MS, 2 * MIN)
assert.equal(ALARM_WAIT_MS, 15 * MIN)
assert.equal(ALARM_AFTER_FAILED_ATTEMPTS, 2)
assert.equal(RETRY_CAP_PER_RUN, 3)

// ── backoff: 0 → 5 → 10 → 20 → 40 → 60 min, capped ──
assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 50].map((n) => retryBackoffMs(n) / MIN), [0, 5, 10, 20, 40, 60, 60, 60])
assert.equal(retryBackoffMs(-3), 0)

// ── error text round trip ──
assert.equal(reviewErrorText("unreachable", "fetch failed"), "unreachable")
assert.equal(reviewErrorText("failed", "shim 500"), "failed: shim 500")
assert.equal(reviewErrorText("failed"), "failed")
assert.equal(reviewErrorText("failed", "x".repeat(500)).length, 200)
assert.equal(reviewFailureKind("unreachable"), "unreachable")
assert.equal(reviewFailureKind("failed: empty reply"), "failed")
assert.equal(reviewFailureKind(null), null)

// ── decideTicketRetry ──
assert.deepEqual(decideTicketRetry(ticket(), up), { action: "retry" }, "never tried, shim up")
{ const d = decideTicketRetry(ticket({ lastMessageAt: ago(1) }), up); assert.equal(d.action, "wait"); assert.equal(d.reason, "fresh", "the fire-and-forget review is probably still running") }
assert.deepEqual(decideTicketRetry(ticket({ reviewingAt: ago(2) }), up), { action: "wait", reason: "in_progress" }, "never two reviews at once")
assert.deepEqual(decideTicketRetry(ticket({ reviewingAt: ago(7) }), up), { action: "retry" }, "a stale claim (crashed process) may be taken over")
assert.deepEqual(decideTicketRetry(ticket(), down), { action: "wait", reason: "offline" }, "shim down: send nothing")
assert.deepEqual(decideTicketRetry(ticket({ reviewingAt: ago(1) }), down), { action: "wait", reason: "in_progress" }, "in progress wins over offline (no attempt counted)")
// a model failure backs off…
{
  const t = ticket({ attempts: 2, lastFailedAt: ago(6), lastError: "failed: empty reply" })
  const d = decideTicketRetry(t, up)
  assert.equal(d.action, "wait"); assert.equal(d.reason, "backoff"); assert.equal(d.until.getTime(), NOW + 4 * MIN, "2 failures → 10 min after the last")
  assert.deepEqual(decideTicketRetry({ ...t, lastFailedAt: ago(10) }, up), { action: "retry" })
  assert.equal(decideTicketRetry({ ...t, attempts: 9, lastFailedAt: ago(59) }, up).reason, "backoff", "capped at 60 min")
  assert.deepEqual(decideTicketRetry({ ...t, attempts: 9, lastFailedAt: ago(60) }, up), { action: "retry" })
}
// …an unreachable failure is retried as soon as /health answers again, however many attempts piled up
assert.deepEqual(decideTicketRetry(ticket({ attempts: 120, lastFailedAt: ago(1), lastError: "unreachable" }), up), { action: "retry" })

// ── planTicketRetries: oldest first, capped, offline counted separately ──
{
  const ts = [
    ticket({ id: "new", lastMessageAt: ago(5) }),
    ticket({ id: "old", lastMessageAt: ago(300) }),
    ticket({ id: "mid", lastMessageAt: ago(60) }),
    ticket({ id: "mid2", lastMessageAt: ago(50) }),
    ticket({ id: "busy", lastMessageAt: ago(400), reviewingAt: ago(1) }),
    ticket({ id: "fresh", lastMessageAt: ago(1) }),
    ticket({ id: "backoff", lastMessageAt: ago(200), attempts: 3, lastFailedAt: ago(5), lastError: "failed: shim 500" }),
  ]
  const p = planTicketRetries(ts, up)
  assert.deepEqual(p.retry, ["old", "mid", "mid2"], "cap 3, oldest first")
  assert.deepEqual(p.offline, [])
  assert.deepEqual(Object.fromEntries(p.waiting.map((w) => [w.id, w.reason])), { busy: "in_progress", backoff: "backoff", new: "cap", fresh: "fresh" })
  const p2 = planTicketRetries(ts, down)
  assert.deepEqual(p2.retry, [], "a dead shim is never called")
  assert.deepEqual(p2.offline, ["old", "backoff", "mid", "mid2", "new"])
  assert.deepEqual(planTicketRetries(ts, up, 1).retry, ["old"])
}

// ── shouldAlarmTicket: waited 15 min AND retries keep failing ──
assert.equal(shouldAlarmTicket(ticket({ lastMessageAt: ago(16), attempts: 0 }), NOW), false, "not retried yet: retry first")
assert.equal(shouldAlarmTicket(ticket({ lastMessageAt: ago(16), attempts: 1 }), NOW), false, "one failure can be a blip")
assert.equal(shouldAlarmTicket(ticket({ lastMessageAt: ago(16), attempts: 2 }), NOW), true)
assert.equal(shouldAlarmTicket(ticket({ lastMessageAt: ago(14), attempts: 5 }), NOW), false, "under 15 minutes")

// ── outageSummary + formatWib: "GIDEON unreachable since <time>" ──
{
  const a = ticket({ failingSince: new Date("2026-10-19T03:12:00Z"), lastError: "unreachable" })
  const b = ticket({ failingSince: new Date("2026-10-20T10:00:00Z"), lastError: "unreachable" })
  const c = ticket({ failingSince: new Date("2026-10-21T10:00:00Z"), lastError: "failed: empty reply" })
  assert.deepEqual(outageSummary([b, a], true), { since: new Date("2026-10-19T03:12:00Z"), unreachable: true })
  assert.equal(outageSummary([a, c], true).unreachable, false, "the shim answers, the review fails")
  assert.equal(outageSummary([a, c], false).unreachable, true, "shim down now")
  assert.deepEqual(outageSummary([ticket()], true), { since: null, unreachable: false })
  assert.equal(formatWib(new Date("2026-10-19T03:12:00Z"), "en"), "19 Oct 10:12 WIB")
  assert.match(formatWib(new Date("2026-10-19T03:12:00Z"), "id"), /^19 Okt 10[.:]12 WIB$/)
}

// ── the incident, replayed: shim down 19 Oct 10:00 → 22 Oct 10:00 WIB, cron every 15 min ──
{
  const start = Date.parse("2026-10-19T03:00:00Z"), back = Date.parse("2026-10-22T03:00:00Z")
  let t = ticket({ id: "lupa-absen", lastMessageAt: new Date(start + 5 * MIN) })
  let shimCalls = 0, firstAlarm = null, answeredAt = null
  for (let now = start; now < back + 2 * 3600_000 && !answeredAt; now += 15 * MIN) {
    const shimUp = now >= back
    const plan = planTicketRetries([t], { now, shimUp, claimMs: CLAIM })
    if (plan.offline.includes(t.id)) t = { ...t, attempts: t.attempts + 1, lastFailedAt: new Date(now), failingSince: t.failingSince ?? new Date(now), lastError: "unreachable" }
    if (plan.retry.includes(t.id)) { shimCalls++; if (shimUp) answeredAt = now }
    if (!answeredAt && !firstAlarm && shouldAlarmTicket(t, now)) firstAlarm = now
  }
  assert.equal(shimCalls, 1, "no call while the shim is down; one review once it is back")
  assert.equal(answeredAt, back, "answered on the first run after GIDEON returns, not after a 60-min backoff")
  assert.ok(firstAlarm && firstAlarm - start <= 30 * MIN, "alarm after the retries failed, within half an hour")
}

console.log("gideon-ticket-retry: all assertions passed")
