import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { getAppSetting, setAppSetting } from "@/lib/app-setting"
import { getAppConfig } from "@/lib/app-config"
import { ORG_WORKSPACE_ID, orgRoleOf } from "@/lib/org"
import { attendancePeriodKey, attendancePeriodRange, formatAttendanceDateKey } from "@/lib/attendance"
import { emitGideonCredits } from "@/lib/socket-emitter"

/**
 * GIDEON credits (owner, 18 Oct 2026).
 *
 * Every GIDEON answer costs what its model was paid for: fresh input tokens at the model's input price,
 * cached input at the cache-read price, output tokens at the output price (reasoning tokens are part of
 * output_tokens on the OpenAI Responses wire Hermes uses — verified: reasoning 19 of output 27, total =
 * input + output — so they are billed once, at the output price, inside output). 1 credit = USD 0.001,
 * rounded up, minimum 1 for a cloud tier. The local tier (GIDEON Model 0) is free.
 *
 * Each person has a daily allowance (resets 00:00 Asia/Jakarta, no rollover), spent first, then a monthly
 * pool (the attendance period, 28th → 27th) plus any bonus granted for that period. Defaults by company
 * workspace role; BoD / One Above All change the defaults, override one person, or grant a bonus.
 *
 * Phase 1: every answer is recorded and shown, nothing is refused. Phase 2 (remote config flag
 * `gideonCreditsEnforced`, default off): out of credits → the answer comes from GIDEON Aphrodite (terra),
 * at most FALLBACK_PER_DAY a day; Model 0 stays free and allowed.
 */

/** USD per 1M tokens, from Hermes' models_dev_cache (agents VM, profile gideon-dev, provider openai), 18 Oct 2026. */
export const MODEL_PRICES: Record<string, { input: number; cacheRead: number; cacheWrite: number; output: number }> = {
  "gpt-6-astra": { input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50 },
  "gpt-6.1-sol": { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
  "gpt-6-luna": { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 },
  "gideon-experimental": { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
}

/** The model each tier runs (the shim's table). Used when a usage row names no model, and for display. */
export const TIER_MODELS: Record<string, string> = {
  astra: "gpt-6-astra",
  luna: "gpt-6.1-sol",
  terra: "gpt-6-luna",
  experimental: "gideon-experimental",
}
export const FREE_TIERS = new Set(["experimental"])
export const FALLBACK_TIER = "terra"
export const FALLBACK_PER_DAY = 30

/** System jobs GIDEON does for a person without being asked: recorded, never charged. */
const NON_BILLABLE_TRIGGERS = new Set(["REFLECTION", "TICKET"])

export type CreditRole = "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF"
export const CREDIT_ROLES: CreditRole[] = ["ONE_ABOVE_ALL", "BOD", "MANAGER", "STAFF"]
export type RoleLimit = { unlimited: boolean; daily: number; monthly: number }
export type CreditPolicy = { roles: Record<CreditRole, RoleLimit>; fallbackPerDay: number }

export const DEFAULT_POLICY: CreditPolicy = {
  roles: {
    ONE_ABOVE_ALL: { unlimited: true, daily: 0, monthly: 0 },
    BOD: { unlimited: true, daily: 0, monthly: 0 },
    MANAGER: { unlimited: false, daily: 300, monthly: 3000 },
    STAFF: { unlimited: false, daily: 100, monthly: 1000 },
  },
  fallbackPerDay: FALLBACK_PER_DAY,
}
const POLICY_KEY = "gideon-credits"
export const MAX_LIMIT = 10_000_000

/** One model's share of a run, as the shim reports it (state.db session_model_usage rows). */
export type ShimUsageRow = {
  model?: string
  task?: string
  apiCalls?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
export type ShimUsage = { source?: string; sessionId?: string | null; tier?: string; model?: string; byModel?: ShimUsageRow[] }

function int(v: unknown): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2_000_000_000) : 0
}

/** Accept the shim's `usage` object only when it has the expected shape; anything else is null. */
export function parseShimUsage(raw: unknown): ShimUsage | null {
  if (!raw || typeof raw !== "object") return null
  const u = raw as Record<string, unknown>
  const rows = Array.isArray(u.byModel) ? u.byModel : null
  if (!rows || !rows.length) return null
  return {
    source: typeof u.source === "string" ? u.source.slice(0, 20) : undefined,
    sessionId: typeof u.sessionId === "string" ? u.sessionId.slice(0, 80) : null,
    tier: typeof u.tier === "string" ? u.tier.slice(0, 20) : undefined,
    model: typeof u.model === "string" ? u.model.slice(0, 80) : undefined,
    byModel: rows.slice(0, 20).map((r) => {
      const x = (r ?? {}) as Record<string, unknown>
      return {
        model: typeof x.model === "string" ? x.model.slice(0, 80) : "",
        task: typeof x.task === "string" ? x.task.slice(0, 40) : "",
        apiCalls: int(x.apiCalls),
        inputTokens: int(x.inputTokens),
        outputTokens: int(x.outputTokens),
        cacheReadTokens: int(x.cacheReadTokens),
        cacheWriteTokens: int(x.cacheWriteTokens),
        reasoningTokens: int(x.reasoningTokens),
      }
    }),
  }
}

export type PricedUsage = {
  model: string
  inputTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  apiCalls: number
  costMicroUsd: number
  credits: number
}

/** Prices one run. Pure: tested in gideon-credits.test.mjs. */
export function priceUsage(usage: ShimUsage, tier: string): PricedUsage {
  const tierModel = TIER_MODELS[tier] || TIER_MODELS.luna
  const free = FREE_TIERS.has(tier)
  let micro = 0
  const sum = { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, apiCalls: 0 }
  for (const r of usage.byModel || []) {
    // An unknown model (a new one the table has not learned) is priced as its tier's model, never as free.
    const price = MODEL_PRICES[r.model || ""] ?? MODEL_PRICES[tierModel]
    const p = free ? MODEL_PRICES["gideon-experimental"] : price
    micro += (r.inputTokens || 0) * p.input + (r.cacheReadTokens || 0) * p.cacheRead + (r.cacheWriteTokens || 0) * p.cacheWrite + (r.outputTokens || 0) * p.output
    sum.inputTokens += r.inputTokens || 0
    sum.cachedTokens += r.cacheReadTokens || 0
    sum.cacheWriteTokens += r.cacheWriteTokens || 0
    sum.outputTokens += r.outputTokens || 0
    sum.reasoningTokens += r.reasoningTokens || 0
    sum.apiCalls += r.apiCalls || 0
  }
  // Prices × tokens are micro-USD; the fractional prices (0.01, 0.125) leave float dust, rounded off here.
  const costMicroUsd = Math.round(micro * 1000) / 1000
  let credits = free ? 0 : Math.ceil(costMicroUsd / 1000 - 1e-9)
  const anyTokens = sum.inputTokens + sum.cachedTokens + sum.outputTokens > 0
  if (!free && anyTokens && credits < 1) credits = 1
  const main = (usage.byModel || []).find((r) => !r.task) || (usage.byModel || [])[0]
  return { model: main?.model || usage.model || tierModel, ...sum, costMicroUsd: Math.ceil(costMicroUsd), credits }
}

// ── Policy ──────────────────────────────────────────────────────────────────────────────────────────

function cleanLimit(v: unknown, fallback: RoleLimit): RoleLimit {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.min(Math.floor(x), MAX_LIMIT) : d)
  return { unlimited: typeof o.unlimited === "boolean" ? o.unlimited : fallback.unlimited, daily: num(o.daily, fallback.daily), monthly: num(o.monthly, fallback.monthly) }
}

export async function getCreditPolicy(): Promise<CreditPolicy> {
  const stored = (await getAppSetting<Partial<CreditPolicy>>(POLICY_KEY).catch(() => null)) ?? {}
  const roles = {} as Record<CreditRole, RoleLimit>
  for (const r of CREDIT_ROLES) roles[r] = cleanLimit(stored.roles?.[r], DEFAULT_POLICY.roles[r])
  const fb = typeof stored.fallbackPerDay === "number" && stored.fallbackPerDay >= 0 ? Math.min(Math.floor(stored.fallbackPerDay), 1000) : FALLBACK_PER_DAY
  return { roles, fallbackPerDay: fb }
}

export async function saveCreditPolicy(policy: CreditPolicy): Promise<CreditPolicy> {
  const roles = {} as Record<CreditRole, RoleLimit>
  for (const r of CREDIT_ROLES) roles[r] = cleanLimit(policy.roles?.[r], DEFAULT_POLICY.roles[r])
  const clean: CreditPolicy = { roles, fallbackPerDay: Math.min(Math.max(0, Math.floor(policy.fallbackPerDay ?? FALLBACK_PER_DAY)), 1000) }
  await setAppSetting(POLICY_KEY, clean)
  return clean
}

export async function creditsEnforced(): Promise<boolean> {
  return (await getAppConfig(null).catch(() => null))?.flags.gideonCreditsEnforced === true
}

// ── Keys ────────────────────────────────────────────────────────────────────────────────────────────

export function creditKeys(at: Date = new Date()) {
  const dayKey = formatAttendanceDateKey(at)
  const periodKey = attendancePeriodKey(dayKey)
  return { dayKey, periodKey }
}

/** "YYYY-MM-DD" → the instant that day starts in Asia/Jakarta (fixed +07:00). */
function jakartaMidnight(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00+07:00`)
}
function nextDayKey(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
export function periodInfo(periodKey: string) {
  const { start, end } = attendancePeriodRange(periodKey)
  const startKey = start.toISOString().slice(0, 10)
  const endKey = end.toISOString().slice(0, 10)
  return { startKey, endKey, resetsAt: jakartaMidnight(nextDayKey(endKey)).toISOString() }
}

// ── Limits ──────────────────────────────────────────────────────────────────────────────────────────

export type EffectiveLimits = {
  role: CreditRole | null
  unlimited: boolean
  daily: number
  monthly: number
  bonus: number
  overridden: boolean
}

export async function effectiveLimits(userId: string, periodKey: string, db: Prisma.TransactionClient = prisma, policy?: CreditPolicy): Promise<EffectiveLimits> {
  const [role, pol, override, bonus] = await Promise.all([
    orgRoleOf(userId).catch(() => null),
    policy ? Promise.resolve(policy) : getCreditPolicy(),
    db.gideonCreditOverride.findUnique({ where: { userId } }),
    db.gideonCreditBonus.aggregate({ where: { userId, periodKey }, _sum: { credits: true } }),
  ])
  return limitsFrom((role as CreditRole | null) ?? null, pol, override, bonus._sum.credits ?? 0)
}

/** Role default ← per-person override (null fields follow the role) + the period's bonus. Pure. */
export function limitsFrom(
  role: CreditRole | null,
  pol: CreditPolicy,
  override: { unlimited: boolean | null; dailyLimit: number | null; monthlyLimit: number | null } | null,
  bonus: number,
): EffectiveLimits {
  // Not a company member (a personal-workspace sign-up): the Staff defaults.
  const base = pol.roles[role ?? "STAFF"] ?? pol.roles.STAFF
  return {
    role,
    unlimited: override?.unlimited ?? base.unlimited,
    daily: override?.dailyLimit ?? base.daily,
    monthly: override?.monthlyLimit ?? base.monthly,
    bonus,
    overridden: Boolean(override && (override.unlimited !== null || override.dailyLimit !== null || override.monthlyLimit !== null)),
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────────────

export type CreditSummary = {
  unlimited: boolean
  role: CreditRole | null
  dayKey: string
  periodKey: string
  period: { startKey: string; endKey: string; resetsAt: string }
  dayResetsAt: string
  today: { used: number; limit: number; remaining: number; answers: number }
  pool: { used: number; limit: number; bonus: number; remaining: number }
  period_used: number
  over: number
  fallbackToday: number
  fallbackPerDay: number
  enforced: boolean
  /** Phase 2 view: what the next answer from a paid tier would be (ok | fallback | blocked). Never set while not enforced. */
  next: "ok" | "fallback" | "blocked"
}

type Sums = { todayCredits: number; todayDaily: number; todayAnswers: number; periodCredits: number; periodPool: number; periodOver: number; fallbackToday: number }

async function usageSums(db: Prisma.TransactionClient, userId: string, dayKey: string, periodKey: string): Promise<Sums> {
  const [today, period, fb] = await Promise.all([
    db.gideonCreditUsage.aggregate({ where: { userId, dayKey, billable: true }, _sum: { credits: true, dailyCredits: true }, _count: { _all: true } }),
    db.gideonCreditUsage.aggregate({ where: { userId, periodKey, billable: true }, _sum: { credits: true, poolCredits: true, overCredits: true } }),
    db.gideonCreditUsage.count({ where: { userId, dayKey, fallback: true } }),
  ])
  return {
    todayCredits: today._sum.credits ?? 0,
    todayDaily: today._sum.dailyCredits ?? 0,
    todayAnswers: today._count._all,
    periodCredits: period._sum.credits ?? 0,
    periodPool: period._sum.poolCredits ?? 0,
    periodOver: period._sum.overCredits ?? 0,
    fallbackToday: fb,
  }
}

function summarize(limits: EffectiveLimits, s: Sums, keys: { dayKey: string; periodKey: string }, enforced: boolean, fallbackPerDay: number): CreditSummary {
  const dailyRemaining = limits.unlimited ? 0 : Math.max(0, limits.daily - s.todayDaily)
  const poolLimit = limits.monthly + limits.bonus
  const poolRemaining = limits.unlimited ? 0 : Math.max(0, poolLimit - s.periodPool)
  let next: CreditSummary["next"] = "ok"
  if (enforced && !limits.unlimited && dailyRemaining + poolRemaining <= 0) next = s.fallbackToday < fallbackPerDay ? "fallback" : "blocked"
  return {
    unlimited: limits.unlimited,
    role: limits.role,
    dayKey: keys.dayKey,
    periodKey: keys.periodKey,
    period: periodInfo(keys.periodKey),
    dayResetsAt: jakartaMidnight(nextDayKey(keys.dayKey)).toISOString(),
    // `used` today counts every credit spent today, whichever bucket paid it; the bar is against the allowance.
    today: { used: s.todayCredits, limit: limits.unlimited ? 0 : limits.daily, remaining: dailyRemaining, answers: s.todayAnswers },
    pool: { used: s.periodPool, limit: limits.unlimited ? 0 : poolLimit, bonus: limits.bonus, remaining: poolRemaining },
    period_used: s.periodCredits,
    over: s.periodOver,
    fallbackToday: s.fallbackToday,
    fallbackPerDay,
    enforced,
    next,
  }
}

export async function creditSummary(userId: string, at: Date = new Date()): Promise<CreditSummary> {
  const keys = creditKeys(at)
  const policy = await getCreditPolicy()
  const [limits, sums, enforced] = await Promise.all([effectiveLimits(userId, keys.periodKey, prisma, policy), usageSums(prisma, userId, keys.dayKey, keys.periodKey), creditsEnforced()])
  return summarize(limits, sums, keys, enforced, policy.fallbackPerDay)
}

// ── Recording ───────────────────────────────────────────────────────────────────────────────────────

export type RecordInput = {
  userId: string
  runId?: string | null
  trigger: string
  tier: string
  requestedTier?: string | null
  fallback?: boolean
  usage: ShimUsage
  at?: Date
}

/**
 * Writes one answer's row and splits its credits over the buckets: the daily allowance first, then the
 * monthly pool, the rest "over". Serialised per person by a transaction-scoped advisory lock, so twenty
 * answers finishing together each see the previous one's split (no bucket is spent twice). Idempotent on
 * runId. Never throws: a failed write must not fail an answer already delivered. Returns the new summary.
 */
export async function recordGideonUsage(input: RecordInput): Promise<{ credits: number; summary: CreditSummary | null; duplicate?: boolean } | null> {
  try {
    const at = input.at ?? new Date()
    const keys = creditKeys(at)
    const tier = TIER_MODELS[input.tier] ? input.tier : "luna"
    const priced = priceUsage(input.usage, tier)
    const billable = !NON_BILLABLE_TRIGGERS.has(input.trigger)
    const policy = await getCreditPolicy()
    const role = await orgRoleOf(input.userId).catch(() => null)

    const out = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gideon-credits|${input.userId}`})::int8)`
      if (input.runId) {
        const seen = await tx.gideonCreditUsage.findUnique({ where: { runId: input.runId }, select: { credits: true } })
        if (seen) return { credits: seen.credits, duplicate: true as const, limits: null, sums: null }
      }
      const limits = await effectiveLimits(input.userId, keys.periodKey, tx, policy)
      const sums = await usageSums(tx, input.userId, keys.dayKey, keys.periodKey)
      let daily = 0, pool = 0, over = 0
      if (billable && !limits.unlimited) {
        let left = priced.credits
        daily = Math.min(left, Math.max(0, limits.daily - sums.todayDaily))
        left -= daily
        pool = Math.min(left, Math.max(0, limits.monthly + limits.bonus - sums.periodPool))
        left -= pool
        over = left
      }
      await tx.gideonCreditUsage.create({
        data: {
          userId: input.userId,
          workspaceId: role ? ORG_WORKSPACE_ID : null,
          role: role ?? null,
          runId: input.runId || null,
          trigger: input.trigger,
          tier,
          requestedTier: input.requestedTier && input.requestedTier !== tier ? input.requestedTier : null,
          model: priced.model,
          inputTokens: priced.inputTokens,
          cachedTokens: priced.cachedTokens,
          cacheWriteTokens: priced.cacheWriteTokens,
          outputTokens: priced.outputTokens,
          reasoningTokens: priced.reasoningTokens,
          apiCalls: priced.apiCalls,
          costMicroUsd: priced.costMicroUsd,
          credits: priced.credits,
          dailyCredits: daily,
          poolCredits: pool,
          overCredits: over,
          billable,
          unlimited: limits.unlimited,
          fallback: input.fallback === true,
          sessionId: input.usage.sessionId || null,
          source: input.usage.source || null,
          dayKey: keys.dayKey,
          periodKey: keys.periodKey,
          createdAt: at,
        },
      })
      const after: Sums = {
        ...sums,
        todayCredits: sums.todayCredits + (billable ? priced.credits : 0),
        todayDaily: sums.todayDaily + daily,
        todayAnswers: sums.todayAnswers + (billable ? 1 : 0),
        periodCredits: sums.periodCredits + (billable ? priced.credits : 0),
        periodPool: sums.periodPool + pool,
        periodOver: sums.periodOver + over,
        fallbackToday: sums.fallbackToday + (input.fallback ? 1 : 0),
      }
      return { credits: priced.credits, duplicate: false as const, limits, sums: after }
    }, { timeout: 15_000, maxWait: 15_000 })

    if (out.duplicate || !out.limits || !out.sums) return { credits: out.credits, summary: null, duplicate: true }
    const summary = summarize(out.limits, out.sums, keys, await creditsEnforced(), policy.fallbackPerDay)
    emitGideonCredits(input.userId, summary)
    return { credits: out.credits, summary }
  } catch (error) {
    console.error("gideon-credits: record failed", error)
    return null
  }
}

/** Records a run's usage from its GideonRun row (user, trigger, tier). Used by finishRun. */
export async function recordRunUsage(runId: string, usage: ShimUsage) {
  const run = await prisma.gideonRun.findUnique({ where: { id: runId }, select: { userId: true, trigger: true, tier: true } }).catch(() => null)
  if (!run?.userId) return null
  return recordGideonUsage({ userId: run.userId, runId, trigger: run.trigger, tier: run.tier || usage.tier || "luna", usage })
}

// ── Phase 2: which tier answers ─────────────────────────────────────────────────────────────────────

export type TierDecision = { tier: string; fallback: boolean; blocked: boolean; summary: CreditSummary | null }

/**
 * With `gideonCreditsEnforced` off (phase 1) this is always the requested tier. On: the free tier is
 * always allowed; a person with no credits left gets terra (at most fallbackPerDay a day), then a refusal.
 */
export async function decideTier(userId: string, requested: string): Promise<TierDecision> {
  if (FREE_TIERS.has(requested)) return { tier: requested, fallback: false, blocked: false, summary: null }
  const enforced = await creditsEnforced()
  if (!enforced) return { tier: requested, fallback: false, blocked: false, summary: null }
  const summary = await creditSummary(userId).catch(() => null)
  if (!summary || summary.next === "ok") return { tier: requested, fallback: false, blocked: false, summary }
  if (summary.next === "fallback") return { tier: FALLBACK_TIER, fallback: true, blocked: false, summary }
  return { tier: requested, fallback: false, blocked: true, summary }
}

/** The notice shown when an answer is served by Aphrodite or refused (EN + ID; the client picks). */
export function creditNotice(kind: "fallback" | "blocked", s: CreditSummary | null) {
  const left = s ? Math.max(0, s.fallbackPerDay - s.fallbackToday - 1) : 0
  if (kind === "fallback") {
    return {
      en: `You're out of GIDEON credits, so GIDEON Aphrodite answered this one. ${left} Aphrodite answers left today. Your daily credits come back at 00:00 WIB.`,
      id: `Kredit GIDEON kamu habis, jadi pertanyaan ini dijawab GIDEON Aphrodite. Sisa ${left} jawaban Aphrodite hari ini. Kredit harian kembali pukul 00.00 WIB.`,
    }
  }
  return {
    en: "You're out of GIDEON credits for today, including the backup answers. GIDEON Model 0 is still free. Your daily credits come back at 00:00 WIB.",
    id: "Kredit GIDEON kamu habis untuk hari ini, termasuk jawaban cadangan. GIDEON Model 0 tetap gratis. Kredit harian kembali pukul 00.00 WIB.",
  }
}
