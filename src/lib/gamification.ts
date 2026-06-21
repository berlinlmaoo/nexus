import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"

// ===== Levels (mirror apps/nexus-lovable-ui/src/lib/levels.ts) =====
// Period-based scoring: every user starts each period at PERIOD_BASELINE_XP (1000 =
// Diamond) and quests move them up (toward Anak Kesayangan AA = 1500) or down
// (penalty quests → Gold/Silver/Iron, can go negative). Tiers rescaled to top out at 1500.
export const PERIOD_BASELINE_XP = 1000
export const LEVELS: { level: number; name: string; floor: number }[] = [
  { level: 1, name: "Iron", floor: 0 },
  { level: 2, name: "Bronze", floor: 200 },
  { level: 3, name: "Silver", floor: 400 },
  { level: 4, name: "Gold", floor: 600 },
  { level: 5, name: "Platinum", floor: 800 },
  { level: 6, name: "Diamond", floor: 1000 },
  { level: 7, name: "Master", floor: 1150 },
  { level: 8, name: "Elite", floor: 1280 },
  { level: 9, name: "Supreme", floor: 1400 },
  { level: 10, name: "Anak Kesayangan AA", floor: 1500 },
]

export function levelForXp(totalXp: number) {
  const xp = Math.max(0, Math.floor(totalXp || 0))
  let idx = 0
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].floor) idx = i
  const tier = LEVELS[idx]
  const next = LEVELS[idx + 1] ?? null
  const span = next ? next.floor - tier.floor : 0
  const pct = next ? Math.min(100, Math.round(((xp - tier.floor) / span) * 100)) : 100
  return { level: tier.level, name: tier.name, floor: tier.floor, nextFloor: next?.floor ?? null, pct, isMax: !next }
}

/**
 * Monthly leaderboard period boundary. The leaderboard "resets" on the 28th at
 * 00:00 Asia/Jakarta — i.e. it only counts XP earned since the most recent 28th.
 * Non-destructive: cumulative UserXp.totalXp (which drives levels) is untouched.
 * Asia/Jakarta is a fixed +07:00 offset (no DST), so the boundary is exact.
 */
const LEADERBOARD_RESET_DAY = 1 // XP period = kalender bulan, reset tiap tanggal 1
const JAKARTA_OFFSET = "+07:00"

export function getLeaderboardPeriodStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const y = get("year")
  const m = get("month") // 1-12
  const d = get("day")
  let py = y
  let pm = m
  if (d < LEADERBOARD_RESET_DAY) {
    pm = m - 1
    if (pm < 1) { pm = 12; py = y - 1 }
  }
  const mm = String(pm).padStart(2, "0")
  const dd = String(LEADERBOARD_RESET_DAY).padStart(2, "0")
  return new Date(`${py}-${mm}-${dd}T00:00:00.000${JAKARTA_OFFSET}`)
}

/** End of the current leaderboard period = next 28th 00:00 Asia/Jakarta. */
export function getLeaderboardPeriodEnd(now: Date = new Date()): Date {
  const start = getLeaderboardPeriodStart(now)
  // start is the 28th. +31 days always lands on the 28th–31st of the NEXT month,
  // which floors back to that month's 28th — the next reset boundary.
  const next = new Date(start)
  next.setUTCDate(next.getUTCDate() + 31)
  return getLeaderboardPeriodStart(next)
}

export function priorityBonus(priority?: string | null): number {
  switch ((priority ?? "").toUpperCase()) {
    case "URGENT": return 20
    case "HIGH": return 10
    case "MEDIUM": return 5
    default: return 0
  }
}

/**
 * Award XP to a user and log a transaction. `amount` may be NEGATIVE (penalty quests).
 * UserXp.totalXp keeps an all-time running tally (can go negative); the displayed
 * score & level are computed per-period as PERIOD_BASELINE_XP + this-period's deltas.
 */
/** Atomically apply a totalXp delta (DB-side increment, so concurrent awards for the SAME user can't
 *  lost-update each other) and reconcile the cached currentLevel from the authoritative new total. */
async function applyXpDelta(tx: Prisma.TransactionClient, userId: string, delta: number) {
  const ux = await tx.userXp.upsert({
    where: { userId },
    create: { userId, totalXp: delta, currentLevel: levelForXp(delta).level },
    update: { totalXp: { increment: delta } },
  })
  const level = levelForXp(ux.totalXp).level
  if (level !== ux.currentLevel) {
    await tx.userXp.update({ where: { userId }, data: { currentLevel: level } })
  }
}

export async function awardXp(userId: string, amount: number, reason: string, taskId?: string) {
  if (!userId || amount === 0) return
  await prisma.$transaction(async (tx) => {
    await applyXpDelta(tx, userId, amount)
    await tx.xpTransaction.create({ data: { userId, amount, reason, taskId: taskId ?? null } })
  })
}

/**
 * Award XP at most ONCE per unique `reason` per user (idempotent). The reason must
 * encode the event + period (e.g. "attendance:late:2026-06-05"). Returns true if it
 * actually awarded, false if it was already applied. Safe to call repeatedly.
 *
 * Concurrency: the check ("already awarded?") and the insert run in ONE transaction guarded by a
 * Postgres transaction-scoped advisory lock keyed on (userId, reason). Two simultaneous calls for the
 * same reason serialize on that lock, so the second sees the first's committed row and returns false —
 * no duplicate ledger row, no double XP. (Without it the old check-then-act TOCTOU let both award.)
 */
export async function awardXpOnce(userId: string, amount: number, reason: string): Promise<boolean> {
  if (!userId || amount === 0) return false
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}|${reason}`})::int8)`
    const already = await tx.xpTransaction.findFirst({ where: { userId, reason }, select: { id: true } })
    if (already) return false
    await applyXpDelta(tx, userId, amount)
    await tx.xpTransaction.create({ data: { userId, amount, reason } })
    return true
  })
}

/**
 * Set a user's running late penalty for a day to an EXACT (negative) amount, keeping
 * UserXp.totalXp consistent. Unlike awardXpOnce, this UPDATES the existing
 * `attendance:late:DATE` ledger entry — so the per-minute accrual job can grow the
 * penalty (-1/min, capped) live as the user stays late & unchecked-in.
 */
export async function setLatePenalty(userId: string, dateKey: string, targetAmount: number) {
  if (!userId) return
  const reason = `attendance:late:${dateKey}`
  await prisma.$transaction(async (tx) => {
    // Serialize against the per-minute accrual job + any concurrent check-in/refund touching this same
    // day's penalty row, so the read-compute-write of `delta` can't race (lost update on totalXp).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}|${reason}`})::int8)`
    const existing = await tx.xpTransaction.findFirst({ where: { userId, reason }, select: { id: true, amount: true } })
    const current = existing?.amount ?? 0
    if (current === targetAmount) return
    const delta = targetAmount - current
    if (existing) {
      await tx.xpTransaction.update({ where: { id: existing.id }, data: { amount: targetAmount } })
    } else {
      await tx.xpTransaction.create({ data: { userId, amount: targetAmount, reason } })
    }
    await applyXpDelta(tx, userId, delta)
  })
}

/** Core refund logic, running inside a caller-supplied transaction so several refunds (+ other writes)
 *  can be made atomic together. Advisory-locked on (userId, reason) so a concurrent refund finds 0 rows
 *  and can't double-credit. */
export async function refundXpByReasonTx(tx: Prisma.TransactionClient, userId: string, reason: string): Promise<number> {
  if (!userId) return 0
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}|${reason}`})::int8)`
  const rows = await tx.xpTransaction.findMany({ where: { userId, reason }, select: { amount: true } })
  if (rows.length === 0) return 0
  const sum = rows.reduce((s, r) => s + r.amount, 0) // negative → refund
  await tx.xpTransaction.deleteMany({ where: { userId, reason } })
  await applyXpDelta(tx, userId, -sum) // -sum is positive XP given back to the user
  return -sum // positive XP given back to the user
}

/** Reverse ALL idempotent XP ledger entries for a reason (delete them, refund the summed totalXp,
 *  recompute level). Handles the rare duplicate-row case. No-op if none exist. Returns the XP amount
 *  refunded back to the user (positive number; 0 if there was nothing to refund). */
export async function refundXpByReason(userId: string, reason: string): Promise<number> {
  if (!userId) return 0
  return await prisma.$transaction((tx) => refundXpByReasonTx(tx, userId, reason))
}

/**
 * Integrity (peer report) verdict with XP transfer — ONE transaction:
 * reporter +bounty, reported −penalty, AND flip the report PENDING→VERIFIED with an XP snapshot.
 * Atomic + idempotent (keyed on the per-report bounty reason) + race-safe (advisory locks both keys in
 * fixed order; updateMany WHERE status=PENDING is the second optimistic lock). Reversible via
 * `reversePeerReportXp` (shared `peer:report:<id>:*` reasons). Only called when XP is enabled by the route.
 */
export async function verifyPeerReportWithXp(opts: { reportId: string; reviewerId: string; reviewNote?: string | null; bounty: number; penalty: number }): Promise<{ ok: boolean; reason?: string }> {
  const reporterKey = `peer:report:${opts.reportId}:bounty`
  const reportedKey = `peer:report:${opts.reportId}:penalty`
  const [k1, k2] = [reporterKey, reportedKey].sort() // fixed lock order → no deadlock
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${k1})::int8)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${k2})::int8)`
    const already = await tx.xpTransaction.findFirst({ where: { reason: reporterKey }, select: { id: true } })
    if (already) return { ok: false, reason: "already_applied" }
    const report = await tx.peerReport.findUnique({ where: { id: opts.reportId }, select: { reporterId: true, reportedUserId: true, status: true } })
    if (!report) return { ok: false, reason: "not_found" }
    if (report.status !== "PENDING") return { ok: false, reason: "already_decided" }
    await applyXpDelta(tx, report.reporterId, opts.bounty)
    await tx.xpTransaction.create({ data: { userId: report.reporterId, amount: opts.bounty, reason: reporterKey } })
    await applyXpDelta(tx, report.reportedUserId, -opts.penalty)
    await tx.xpTransaction.create({ data: { userId: report.reportedUserId, amount: -opts.penalty, reason: reportedKey } })
    const upd = await tx.peerReport.updateMany({
      where: { id: opts.reportId, status: "PENDING" },
      data: { status: "VERIFIED", reviewerId: opts.reviewerId, reviewedAt: new Date(), reviewNote: opts.reviewNote ?? null, reporterBountyXp: opts.bounty, reportedPenaltyXp: opts.penalty, xpAppliedAt: new Date() },
    })
    if (upd.count === 0) throw new Error("ALREADY_DECIDED")
    await tx.peerReportEvent.create({ data: { reportId: opts.reportId, action: "verified", fromStatus: "PENDING", toStatus: "VERIFIED", note: opts.reviewNote ?? null, actorId: opts.reviewerId } })
    return { ok: true }
  })
}

/** Reverse a verified report's XP (appeal/overturn) — refunds both the bounty and penalty ledger rows. */
export async function reversePeerReportXp(reportId: string): Promise<void> {
  const report = await prisma.peerReport.findUnique({ where: { id: reportId }, select: { reporterId: true, reportedUserId: true } })
  if (!report) return
  await prisma.$transaction(async (tx) => {
    await refundXpByReasonTx(tx, report.reporterId, `peer:report:${reportId}:bounty`)
    await refundXpByReasonTx(tx, report.reportedUserId, `peer:report:${reportId}:penalty`)
  })
}

/** Clear a day's running late penalty (e.g. when a day-off is filed retroactively). */
export async function clearLatePenalty(userId: string, dateKey: string) {
  await refundXpByReason(userId, `attendance:late:${dateKey}`)
}

/** This period's score for one user = baseline 1000 + sum of this-period XP deltas (can be negative). */
export async function getPeriodScore(userId: string, periodStart: Date = getLeaderboardPeriodStart()): Promise<number> {
  const agg = await prisma.xpTransaction.aggregate({
    _sum: { amount: true },
    where: { userId, createdAt: { gte: periodStart } },
  })
  return PERIOD_BASELINE_XP + (agg._sum.amount ?? 0)
}

/** Increment the daily streak; awards a small bonus once per UTC day. */
export async function bumpStreak(userId: string) {
  if (!userId) return
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const streak = await prisma.userStreak.findUnique({ where: { userId } })
  const last = streak?.lastActivityDay ? new Date(streak.lastActivityDay) : null
  if (last) last.setUTCHours(0, 0, 0, 0)
  if (last && last.getTime() === today.getTime()) return // already counted today
  const yesterday = new Date(today); yesterday.setUTCDate(today.getUTCDate() - 1)
  const current = last && last.getTime() === yesterday.getTime() ? (streak?.currentStreak ?? 0) + 1 : 1
  const longest = Math.max(current, streak?.longestStreak ?? 0)
  await prisma.userStreak.upsert({
    where: { userId },
    create: { userId, currentStreak: current, longestStreak: longest, lastActivityDay: today },
    update: { currentStreak: current, longestStreak: longest, lastActivityDay: today },
  })
  // No XP for streaks — XP is quest-only (assigned by Head/BoD). The streak counter is
  // kept as an activity stat, but it no longer adds points.
}

// ===== Auto-quest templates (progress computed live). Dikosongkan — quest lama dihapus. =====
export const AUTO_QUESTS: { key: string; title: string; requirementType: string; requiredCount: number; xpReward: number }[] = []

/** ISO-week period key e.g. "2026-W23" for weekly quest reset. */
export function currentPeriodKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

function weekStart(d = new Date()): Date {
  const date = new Date(d); date.setUTCHours(0, 0, 0, 0)
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum)
  return date
}

// A specific_tasks quest is a one-time bundle — claimed once ever (not per week), so its claims use this
// fixed period bucket instead of the ISO-week key.
export const QUEST_ONCE_PERIOD = "once"

/** Live progress for a quest definition for a given user (this week). */
export async function computeQuestProgress(userId: string, q: { requirementType: string; taskIds?: string[] }): Promise<number> {
  const since = weekStart()
  if (q.requirementType === "specific_tasks") {
    // Progress = how many of the quest's EXACT tasks are DONE. Shared (it's the bundle's completion, not
    // per-user) and not time-windowed. Quest is complete when this hits taskIds.length.
    const ids = q.taskIds ?? []
    if (ids.length === 0) return 0
    return prisma.task.count({ where: { id: { in: ids }, status: "DONE" } })
  }
  if (q.requirementType === "task_count") {
    return prisma.task.count({ where: { assignees: { some: { userId } }, status: "DONE", updatedAt: { gte: since } } })
  }
  if (q.requirementType === "priority_done") {
    return prisma.task.count({ where: { assignees: { some: { userId } }, status: "DONE", priority: "URGENT", updatedAt: { gte: since } } })
  }
  if (q.requirementType === "overdue_cleared") {
    // Tasks completed this week that were already past their due date.
    return prisma.task.count({ where: { assignees: { some: { userId } }, status: "DONE", updatedAt: { gte: since }, dueDate: { lt: new Date() } } })
  }
  if (q.requirementType === "has_overdue") {
    // Penalty condition: tasks assigned to the user that are PAST due and not finished.
    return prisma.task.count({ where: { assignees: { some: { userId } }, status: { notIn: ["DONE", "CANCELLED"] }, dueDate: { lt: new Date() } } })
  }
  return 0
}

/**
 * Auto-apply penalty quests (xpReward < 0) for a user — evaluated lazily on app open.
 * A penalty applies at most ONCE per leaderboard period (idempotent via QuestClaim),
 * even if this runs on every gamification read. Deducts XP when the bad condition is met.
 */
export async function applyAutoPenalties(userId: string): Promise<void> {
  if (!userId) return
  const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })
  const workspaceIds = memberships.map((m) => m.workspaceId)
  if (workspaceIds.length === 0) return

  const penalties = await prisma.quest.findMany({
    where: { workspaceId: { in: workspaceIds }, isActive: true, xpReward: { lt: 0 } },
  })
  if (penalties.length === 0) return

  const periodKey = `pen:${getLeaderboardPeriodStart().toISOString().slice(0, 10)}`
  for (const q of penalties) {
    const progress = await computeQuestProgress(userId, q)
    if (progress < q.requiredCount) continue
    const already = await prisma.questClaim.findUnique({
      where: { userId_questKey_periodKey: { userId, questKey: q.id, periodKey } },
    })
    if (already) continue
    try {
      await prisma.questClaim.create({ data: { userId, questKey: q.id, periodKey, xpAwarded: q.xpReward, questId: q.id } })
      await awardXp(userId, q.xpReward, "penalty")
    } catch {
      // Unique-constraint race → another request already applied it this period. Safe to ignore.
    }
  }
}
