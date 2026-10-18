import { timingSafeEqual } from "crypto"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma"
import { getAppSetting } from "@/lib/app-setting"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { getTierStatus, type TierStatus } from "@/lib/gideon-tier-status"
import { createInAppNotification } from "@/lib/notification-service"
import { bi } from "@/lib/notification-text"
import { ORG_WORKSPACE_ID, isOrgBodPlus } from "@/lib/org"
import { createLogger } from "@/lib/logger"
import { NON_MODEL_FAILURES, SHIM_RESTART } from "@/lib/gideon-shim-retry"

/**
 * Control Room › GIDEON › Performance (owner, 18 Oct 2026). BoD / One Above All only.
 *
 * Two sources:
 *  - The office GPU that runs GIDEON Model 0, pushed by a tiny host exporter (deploy/gideon-perf/) to
 *    POST /api/gideon/perf/ingest with a shared secret (GIDEON_PERF_INGEST_SECRET): nvidia-smi, the local engine's
 *    loaded model (size vs size on the GPU), the meeting transcriber's queue, and Model 0 generations / loads read
 *    from the engine log. Stored in GideonGpuSample / GideonModel0Event.
 *  - Every answer: GideonRun (latency, errors, in flight, router-miss retries, tools) and GideonCreditUsage
 *    (credits, cached vs fresh input tokens).
 *
 * Live: the room `gideon:perf` (BoD+ only, pages/api/socket.ts) gets `gideon-perf` { kind: "gpu", live } on every
 * sample and { kind: "runs" } when an answer starts or ends. The ingest reply tells the exporter to sample every
 * 5 s while somebody has the panel open and every 60 s otherwise.
 *
 * Alerts to the One Above All (notification type GIDEON_ALERT), each once per episode: Model 0 down > 5 min,
 * error rate > 5 % over 15 min (at least 5 answers), VRAM ≥ 98 % for 2 min, GPU ≥ 85 °C for 2 min. A recovery
 * notice follows when it clears; an alert that comes back within 30 min of clearing is not sent again.
 *
 * Not model errors (lib/gideon-shim-retry.ts NON_MODEL_FAILURES): `model0_unavailable` (the GPU was away) and
 * `shim_restart` (the shim restarted under the answer). Neither counts in the error rate, the "last 3 answers failed"
 * rule or the error-rate alert; restarts are shown as their own small count per tier.
 */

const log = createLogger("gideon-perf")

export const PERF_ROOM = "gideon:perf"
export const TIER_IDS = ["astra", "luna", "terra", "experimental"] as const
export type TierId = (typeof TIER_IDS)[number]

export const THRESHOLDS = {
  model0DownMin: 5,
  errorRatePct: 5,
  errorRateWindowMin: 15,
  errorRateMinAnswers: 5,
  vramFullPct: 98,
  gpuHotC: 85,
  sustainMin: 2,
} as const

/** Telemetry older than this is "stopped" (the exporter samples at least every 60 s). */
const STALE_MS = 3 * 60_000
const WINDOW_MS = 15 * 60_000
const DAY_MS = 24 * 3600_000
/** A RUNNING row older than this is a run that died without finishing, not one in flight. */
const INFLIGHT_MAX_MS = 10 * 60_000

// ── Access ────────────────────────────────────────────────────────────────────────────────────────────

export async function canSeePerf(userId: string): Promise<boolean> {
  return isOrgBodPlus(userId).catch(() => false)
}

/** Constant-time check of the exporter's bearer secret. No secret configured = ingest is off. */
export function ingestAuthorized(header: string | null): boolean {
  const secret = process.env.GIDEON_PERF_INGEST_SECRET || ""
  if (secret.length < 24 || !header?.startsWith("Bearer ")) return false
  const got = Buffer.from(header.slice(7))
  const want = Buffer.from(secret)
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Sockets with the panel open in this process (pages/api/socket.ts registers the counter). */
export function perfWatchers(): number {
  const fn = (globalThis as unknown as { __gideonPerfWatchers?: () => number }).__gideonPerfWatchers
  try {
    return fn ? fn() : 0
  } catch {
    return 0
  }
}

// ── Ingest ────────────────────────────────────────────────────────────────────────────────────────────

export type LiveGpu = {
  at: string
  gpu: { name: string | null; util: number | null; memUsedMiB: number | null; memTotalMiB: number | null; tempC: number | null; powerW: number | null; powerLimitW: number | null } | null
  engine: { up: boolean; model: { name: string; sizeBytes: number; sizeVramBytes: number; gpuShare: number | null; contextLength: number | null; expiresAt: string | null } | null } | null
  whisper: { up: boolean; busy: boolean; queued: number } | null
}

const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)
const iso = (v: unknown): Date | null => {
  if (typeof v !== "string") return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) || Math.abs(Date.now() - d.getTime()) > 7 * DAY_MS ? null : d
}

/** The exporter's JSON → a clean live view + rows. Anything malformed is dropped, never trusted. */
export function parseIngest(body: unknown): { live: LiveGpu; events: Prisma.GideonModel0EventCreateManyInput[] } | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  if (b.v !== 1) return null
  const g = (b.gpu && typeof b.gpu === "object" ? b.gpu : null) as Record<string, unknown> | null
  const o = (b.engine && typeof b.engine === "object" ? b.engine : null) as Record<string, unknown> | null
  const w = (b.whisper && typeof b.whisper === "object" ? b.whisper : null) as Record<string, unknown> | null
  const models = Array.isArray(o?.models) ? (o!.models as Record<string, unknown>[]) : []
  const m = models[0]
  const size = m ? num(m.size, 0, 1e13) : null
  const vram = m ? num(m.sizeVram, 0, 1e13) : null
  const live: LiveGpu = {
    at: new Date().toISOString(),
    gpu: g
      ? {
          name: str(g.name, 80), util: num(g.util, 0, 100), memUsedMiB: num(g.memUsed, 0, 1e6), memTotalMiB: num(g.memTotal, 0, 1e6),
          tempC: num(g.temp, -20, 150), powerW: num(g.power, 0, 2000), powerLimitW: num(g.powerLimit, 0, 2000),
        }
      : null,
    engine: o
      ? {
          up: o.up === true,
          model: m && str(m.name) && size != null
            ? { name: str(m.name)!, sizeBytes: size, sizeVramBytes: vram ?? 0, gpuShare: size > 0 && vram != null ? Math.min(1, vram / size) : null, contextLength: num(m.ctx, 0, 1e7), expiresAt: iso(m.expiresAt)?.toISOString() ?? null }
            : null,
        }
      : null,
    whisper: w ? { up: w.up === true, busy: w.busy === true, queued: num(w.queued, 0, 1e4) ?? 0 } : null,
  }
  const events: Prisma.GideonModel0EventCreateManyInput[] = []
  for (const e of (Array.isArray(b.events) ? b.events : []).slice(0, 200) as Record<string, unknown>[]) {
    const ref = str(e?.ref, 64)
    const at = iso(e?.at)
    if (!ref || !at) continue
    if (e.kind === "gen") {
      events.push({
        ref, at, kind: "gen", evalTps: num(e.evalTps, 0, 1e5), promptTps: num(e.promptTps, 0, 1e7),
        outTokens: num(e.outTokens, 0, 1e7), promptTokens: num(e.promptTokens, 0, 1e7), totalMs: num(e.totalMs, 0, 1e8),
      })
    } else if (e.kind === "load") {
      events.push({ ref, at, kind: "load", loadSec: num(e.loadSec, 0, 1e5) })
    }
  }
  return { live, events }
}

export async function storeIngest(live: LiveGpu, events: Prisma.GideonModel0EventCreateManyInput[]): Promise<void> {
  const m = live.engine?.model
  await prisma.gideonGpuSample.create({
    data: {
      at: new Date(live.at), res: "raw",
      gpuName: live.gpu?.name ?? null, gpuUtil: live.gpu?.util ?? null,
      memUsedMiB: live.gpu?.memUsedMiB != null ? Math.round(live.gpu.memUsedMiB) : null,
      memTotalMiB: live.gpu?.memTotalMiB != null ? Math.round(live.gpu.memTotalMiB) : null,
      tempC: live.gpu?.tempC ?? null, powerW: live.gpu?.powerW ?? null, powerLimitW: live.gpu?.powerLimitW ?? null,
      engineUp: live.engine ? live.engine.up : null,
      modelName: m?.name ?? null, sizeBytes: m ? BigInt(Math.round(m.sizeBytes)) : null, sizeVramBytes: m ? BigInt(Math.round(m.sizeVramBytes)) : null,
      whisperBusy: live.whisper?.busy ?? null, whisperQueued: live.whisper?.queued ?? null,
    },
  })
  if (events.length) await prisma.gideonModel0Event.createMany({ data: events, skipDuplicates: true })
  eventBus.emit(BUS_EVENTS.GIDEON_PERF, { kind: events.length ? "gpu+model0" : "gpu", live })
}

/** An answer started or ended: the open panels refetch (pages/api/socket.ts folds bursts into one ping). */
export function pingPerfRuns(): void {
  try {
    eventBus.emit(BUS_EVENTS.GIDEON_PERF, { kind: "runs" })
  } catch {
    /* never fail an answer over the panel */
  }
}

// ── Retention ─────────────────────────────────────────────────────────────────────────────────────────

const PRUNE_EVERY_MS = 3600_000
const pruneState = ((globalThis as unknown as { __gideonPerfPrune?: { at: number } }).__gideonPerfPrune ??= { at: 0 })

/**
 * Raw GPU samples older than 48 h → 10-minute averages; 10-minute rows and Model 0 events older than 30 days go.
 * At most hourly per process, one process at a time (transaction-level advisory lock), idempotent.
 */
export async function pruneGpuSamples(force = false): Promise<{ folded: number; deleted: number } | null> {
  if (!force && Date.now() - pruneState.at < PRUNE_EVERY_MS) return null
  pruneState.at = Date.now()
  const cut = new Date(Math.floor((Date.now() - 2 * DAY_MS) / 600_000) * 600_000)
  const old = new Date(Date.now() - 30 * DAY_MS)
  try {
    return await prisma.$transaction(async (tx) => {
      const [{ got }] = await tx.$queryRaw<{ got: boolean }[]>`SELECT pg_try_advisory_xact_lock(4632018907) AS got`
      if (!got) return null
      const folded = await tx.$executeRaw`
        INSERT INTO "GideonGpuSample" ("at","res","gpuName","gpuUtil","memUsedMiB","memTotalMiB","tempC","powerW","powerLimitW","engineUp","modelName","sizeBytes","sizeVramBytes","whisperBusy","whisperQueued")
        SELECT to_timestamp(floor(extract(epoch FROM "at") / 600) * 600) AT TIME ZONE 'UTC', '10m', max("gpuName"), avg("gpuUtil"),
               round(avg("memUsedMiB"))::int, max("memTotalMiB"), avg("tempC"), avg("powerW"), max("powerLimitW"), bool_and("engineUp"),
               max("modelName"), max("sizeBytes"), max("sizeVramBytes"), bool_or("whisperBusy"), max("whisperQueued")
        FROM "GideonGpuSample" WHERE "res" = 'raw' AND "at" < ${cut} GROUP BY 1`
      const raw = await tx.$executeRaw`DELETE FROM "GideonGpuSample" WHERE "res" = 'raw' AND "at" < ${cut}`
      const tenMin = await tx.$executeRaw`DELETE FROM "GideonGpuSample" WHERE "res" = '10m' AND "at" < ${old}`
      const ev = await tx.$executeRaw`DELETE FROM "GideonModel0Event" WHERE "at" < ${old}`
      return { folded, deleted: raw + tenMin + ev }
    })
  } catch (error) {
    log.warn("prune failed", { error: String(error) })
    return null
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────────────────────────────

export type TierLive = {
  id: TierId
  status: "online" | "busy" | "unavailable" | "loading"
  /** Why, when not online: transcribing | loading | down | failing | telemetry. */
  reason: string | null
  inFlight: number
  answers15m: number
  failures15m: number
  /** Answers lost to a shim restart in 15 min / 24 h: not errors, shown apart. */
  restarts15m: number
  restarts24h: number
  errorRate: number | null
  p50Ms: number | null
  p95Ms: number | null
  avgCredits15m: number | null
  avgCredits24h: number | null
  answers24h: number
}

export type PerfHour = {
  t: string
  questions: Record<TierId, number>
  p50Ms: Record<TierId, number | null>
  credits: number
  inputTokens: number
  cachedTokens: number
  cacheHit: number | null
}

export type PerfSummary = {
  now: string
  thresholds: typeof THRESHOLDS
  telemetry: { lastAt: string | null; stale: boolean; cadenceSec: number }
  tiers: TierLive[]
  tierStatus: TierStatus
  live: LiveGpu | null
  model0: {
    recent: { at: string; evalTps: number | null; promptTps: number | null; outTokens: number | null; totalMs: number | null }[]
    loads: { at: string; loadSec: number | null }[]
    avgEvalTps24h: number | null
    gens24h: number
  }
  hours: PerfHour[]
  quality: {
    routerMisses24h: number
    answers24h: number
    recentMisses: { at: string; tier: string | null }[]
    topTools: { tool: string; calls: number; failures: number }[]
    failingTools: { tool: string; calls: number; failures: number }[]
    /** No thumbs up/down exists in NEXUS yet: always null until it does. */
    thumbsDown: null
  }
  alerts: AlertView[]
}

type RunAgg = { tier: string; inflight: bigint; finished: bigint; failed: bigint; restarts: bigint; restarts24: bigint; p50: number | null; p95: number | null; answers24: bigint }

const zeroTiers = <T,>(v: T) => Object.fromEntries(TIER_IDS.map((t) => [t, v])) as Record<TierId, T>
const isTier = (t: string | null): t is TierId => !!t && (TIER_IDS as readonly string[]).includes(t)
const n = (v: bigint | number | null | undefined) => Number(v ?? 0)
/** Finished runs that say something about the model: everything except NON_MODEL_FAILURES (null error included). */
const modelOutcome = (): Prisma.GideonRunWhereInput => ({ OR: [{ error: null }, { error: { notIn: [...NON_MODEL_FAILURES] } }] })

export async function buildPerfSummary(): Promise<PerfSummary> {
  const now = Date.now()
  const since15 = new Date(now - WINDOW_MS)
  const since24 = new Date(now - DAY_MS)
  const inflightSince = new Date(now - INFLIGHT_MAX_MS)
  const hourStart = new Date(Math.floor((now - 23 * 3600_000) / 3600_000) * 3600_000)

  const [runAgg, recentFinished, credits15, credits24, runHours, creditHours, misses, missCount, tools, sample, gens, loads, gen24, tierStatus, alerts] = await Promise.all([
    prisma.$queryRaw<RunAgg[]>`
      SELECT "tier",
        count(*) FILTER (WHERE "status" = 'RUNNING' AND "startedAt" > ${inflightSince}) AS inflight,
        count(*) FILTER (WHERE "status" IN ('SUCCEEDED','FAILED') AND "finishedAt" > ${since15} AND coalesce("error",'') NOT IN ('model0_unavailable','shim_restart')) AS finished,
        count(*) FILTER (WHERE "status" = 'FAILED' AND "finishedAt" > ${since15} AND coalesce("error",'') NOT IN ('model0_unavailable','shim_restart')) AS failed,
        count(*) FILTER (WHERE "status" = 'FAILED' AND "finishedAt" > ${since15} AND "error" = ${SHIM_RESTART}) AS restarts,
        count(*) FILTER (WHERE "status" = 'FAILED' AND "error" = ${SHIM_RESTART}) AS restarts24,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE "status" = 'SUCCEEDED' AND "finishedAt" > ${since15}) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE "status" = 'SUCCEEDED' AND "finishedAt" > ${since15}) AS p95,
        count(*) FILTER (WHERE "startedAt" > ${since24}) AS answers24
      FROM "GideonRun" WHERE "startedAt" > ${since24} AND "tier" IS NOT NULL GROUP BY "tier"`,
    prisma.gideonRun.findMany({
      where: { finishedAt: { gt: since15 }, tier: { not: null }, ...modelOutcome() },
      orderBy: { finishedAt: "desc" }, take: 200, select: { tier: true, status: true },
    }),
    prisma.gideonCreditUsage.groupBy({ by: ["tier"], where: { createdAt: { gt: since15 } }, _avg: { credits: true } }),
    prisma.gideonCreditUsage.groupBy({ by: ["tier"], where: { createdAt: { gt: since24 } }, _avg: { credits: true } }),
    prisma.$queryRaw<{ h: Date; tier: string; q: bigint; p50: number | null }[]>`
      SELECT date_trunc('hour', "startedAt") AS h, "tier", count(*) AS q,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE "status" = 'SUCCEEDED') AS p50
      FROM "GideonRun" WHERE "startedAt" >= ${hourStart} AND "tier" IS NOT NULL GROUP BY 1, 2`,
    prisma.$queryRaw<{ h: Date; credits: bigint | null; input: bigint | null; cached: bigint | null }[]>`
      SELECT date_trunc('hour', "createdAt") AS h, sum("credits") AS credits, sum("inputTokens") AS input, sum("cachedTokens") AS cached
      FROM "GideonCreditUsage" WHERE "createdAt" >= ${hourStart} GROUP BY 1`,
    prisma.gideonRun.findMany({ where: { routerRetry: true, startedAt: { gt: since24 } }, orderBy: { startedAt: "desc" }, take: 5, select: { startedAt: true, tier: true } }),
    prisma.gideonRun.count({ where: { routerRetry: true, startedAt: { gt: since24 } } }),
    prisma.$queryRaw<{ tool: string; calls: bigint; failures: bigint }[]>`
      SELECT "tool", count(*) AS calls, count(*) FILTER (WHERE "ok" = false) AS failures
      FROM "GideonRunStep" WHERE "createdAt" > ${since24} GROUP BY "tool"`,
    prisma.gideonGpuSample.findFirst({ where: { res: "raw" }, orderBy: { at: "desc" } }),
    prisma.gideonModel0Event.findMany({ where: { kind: "gen" }, orderBy: { at: "desc" }, take: 8 }),
    prisma.gideonModel0Event.findMany({ where: { kind: "load" }, orderBy: { at: "desc" }, take: 5 }),
    prisma.gideonModel0Event.aggregate({ where: { kind: "gen", at: { gt: since24 } }, _avg: { evalTps: true }, _count: { _all: true } }),
    getTierStatus(),
    getAlertState(),
  ])

  const live = sample ? sampleToLive(sample) : null
  const lastAt = sample?.at ?? null
  const stale = !lastAt || now - lastAt.getTime() > STALE_MS

  const agg = new Map(runAgg.map((r) => [r.tier, r]))
  const c15 = new Map(credits15.map((c) => [c.tier, c._avg.credits]))
  const c24 = new Map(credits24.map((c) => [c.tier, c._avg.credits]))
  const lastThree = new Map<string, string[]>()
  for (const r of recentFinished) {
    if (!r.tier) continue
    const l = lastThree.get(r.tier) ?? []
    if (l.length < 3) l.push(r.status)
    lastThree.set(r.tier, l)
  }

  const tiers: TierLive[] = TIER_IDS.map((id) => {
    const a = agg.get(id)
    const finished = n(a?.finished)
    const failed = n(a?.failed)
    const inFlight = n(a?.inflight)
    let status: TierLive["status"] = inFlight > 0 ? "busy" : "online"
    let reason: string | null = null
    const l3 = lastThree.get(id) ?? []
    if (l3.length === 3 && l3.every((s) => s === "FAILED")) { status = "unavailable"; reason = "failing" }
    if (id === "experimental") {
      const av = tierStatus.experimental
      if (!av.available) { status = av.reason === "loading" ? "loading" : "unavailable"; reason = av.reason }
      else if (!stale && live?.engine && !live.engine.up) { status = "unavailable"; reason = "down" }
    }
    const round = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10)
    return {
      id, status, reason, inFlight,
      answers15m: finished, failures15m: failed, restarts15m: n(a?.restarts), restarts24h: n(a?.restarts24), errorRate: finished ? failed / finished : null,
      p50Ms: a?.p50 != null ? Math.round(a.p50) : null, p95Ms: a?.p95 != null ? Math.round(a.p95) : null,
      avgCredits15m: round(c15.get(id)), avgCredits24h: round(c24.get(id)), answers24h: n(a?.answers24),
    }
  })

  const hours: PerfHour[] = []
  const byHour = new Map<number, PerfHour>()
  for (let i = 0; i < 24; i++) {
    const t = new Date(hourStart.getTime() + i * 3600_000)
    const h: PerfHour = { t: t.toISOString(), questions: zeroTiers(0), p50Ms: zeroTiers<number | null>(null), credits: 0, inputTokens: 0, cachedTokens: 0, cacheHit: null }
    hours.push(h)
    byHour.set(t.getTime(), h)
  }
  for (const r of runHours) {
    const h = byHour.get(new Date(r.h).getTime())
    if (!h || !isTier(r.tier)) continue
    h.questions[r.tier] = n(r.q)
    h.p50Ms[r.tier] = r.p50 != null ? Math.round(r.p50) : null
  }
  for (const r of creditHours) {
    const h = byHour.get(new Date(r.h).getTime())
    if (!h) continue
    h.credits = n(r.credits)
    h.inputTokens = n(r.input)
    h.cachedTokens = n(r.cached)
    const all = h.inputTokens + h.cachedTokens
    h.cacheHit = all > 0 ? h.cachedTokens / all : null
  }

  const toolRows = tools.map((t) => ({ tool: t.tool, calls: n(t.calls), failures: n(t.failures) }))
  const answers24h = tiers.reduce((s, t) => s + t.answers24h, 0)

  return {
    now: new Date(now).toISOString(),
    thresholds: THRESHOLDS,
    telemetry: { lastAt: lastAt?.toISOString() ?? null, stale, cadenceSec: perfWatchers() > 0 ? 5 : 60 },
    tiers,
    tierStatus,
    live,
    model0: {
      recent: gens.map((g) => ({ at: g.at.toISOString(), evalTps: g.evalTps, promptTps: g.promptTps, outTokens: g.outTokens, totalMs: g.totalMs })),
      loads: loads.map((l) => ({ at: l.at.toISOString(), loadSec: l.loadSec })),
      avgEvalTps24h: gen24._avg.evalTps != null ? Math.round(gen24._avg.evalTps * 10) / 10 : null,
      gens24h: gen24._count._all,
    },
    hours,
    quality: {
      routerMisses24h: missCount,
      answers24h,
      recentMisses: misses.map((m) => ({ at: m.startedAt.toISOString(), tier: m.tier })),
      topTools: [...toolRows].sort((a, b) => b.calls - a.calls).slice(0, 6),
      failingTools: toolRows.filter((t) => t.failures > 0).sort((a, b) => b.failures - a.failures || b.calls - a.calls).slice(0, 6),
      thumbsDown: null,
    },
    alerts: alertViews(alerts),
  }
}

function sampleToLive(s: { at: Date; gpuName: string | null; gpuUtil: number | null; memUsedMiB: number | null; memTotalMiB: number | null; tempC: number | null; powerW: number | null; powerLimitW: number | null; engineUp: boolean | null; modelName: string | null; sizeBytes: bigint | null; sizeVramBytes: bigint | null; whisperBusy: boolean | null; whisperQueued: number | null }): LiveGpu {
  const size = s.sizeBytes != null ? Number(s.sizeBytes) : null
  const vram = s.sizeVramBytes != null ? Number(s.sizeVramBytes) : null
  return {
    at: s.at.toISOString(),
    gpu: { name: s.gpuName, util: s.gpuUtil, memUsedMiB: s.memUsedMiB, memTotalMiB: s.memTotalMiB, tempC: s.tempC, powerW: s.powerW, powerLimitW: s.powerLimitW },
    engine: s.engineUp == null ? null : {
      up: s.engineUp,
      model: s.modelName && size != null ? { name: s.modelName, sizeBytes: size, sizeVramBytes: vram ?? 0, gpuShare: size > 0 && vram != null ? Math.min(1, vram / size) : null, contextLength: null, expiresAt: null } : null,
    },
    whisper: s.whisperBusy == null ? null : { up: true, busy: s.whisperBusy, queued: s.whisperQueued ?? 0 },
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────────────────────────────

export const ALERT_KEYS = ["model0_down", "error_rate", "vram_full", "gpu_hot"] as const
export type AlertKey = (typeof ALERT_KEYS)[number]
type AlertEntry = { pendingSince: string | null; active: boolean; firedAt: string | null; clearedAt: string | null; notified: boolean; value: string | null }
type AlertState = Partial<Record<AlertKey, AlertEntry>>
export type AlertView = { key: AlertKey; active: boolean; since: string | null; value: string | null }

const ALERT_STATE_KEY = "gideon-perf-alerts"
const FLAP_MS = 30 * 60_000

async function getAlertState(): Promise<AlertState> {
  return (await getAppSetting<AlertState>(ALERT_STATE_KEY).catch(() => null)) ?? {}
}
function alertViews(s: AlertState): AlertView[] {
  return ALERT_KEYS.map((key) => ({ key, active: !!s[key]?.active, since: s[key]?.active ? s[key]!.firedAt : null, value: s[key]?.value ?? null }))
}

type Condition = { on: boolean; sustainMs: number; value: string | null; vars: Record<string, string | number> }

const ALERT_TEXT: Record<AlertKey, (v: Record<string, string | number>) => { en: [string, string]; id: [string, string] }> = {
  model0_down: (v) => ({
    en: ["GIDEON Model 0 is down", `The local engine on the office GPU hasn't answered for ${v.min} minutes. The other tiers are fine.`],
    id: ["GIDEON Model 0 mati", `Mesin lokal di GPU kantor tidak merespons selama ${v.min} menit. Tier lain aman.`],
  }),
  error_rate: (v) => ({
    en: ["GIDEON errors are high", `${v.pct}% of answers failed in the last 15 minutes (${v.failed} of ${v.total}).`],
    id: ["Error GIDEON tinggi", `${v.pct}% jawaban gagal dalam 15 menit terakhir (${v.failed} dari ${v.total}).`],
  }),
  vram_full: (v) => ({
    en: ["Office GPU memory is full", `${v.used} of ${v.total} GB VRAM in use for ${v.min} minutes. Model 0 and meeting transcripts may slow down or fail.`],
    id: ["Memori GPU kantor penuh", `VRAM terpakai ${v.used} dari ${v.total} GB selama ${v.min} menit. Model 0 dan transkrip meeting bisa melambat atau gagal.`],
  }),
  gpu_hot: (v) => ({
    en: ["Office GPU is running hot", `${v.temp}°C for ${v.min} minutes (alert at ${v.limit}°C).`],
    id: ["GPU kantor terlalu panas", `${v.temp}°C selama ${v.min} menit (batas peringatan ${v.limit}°C).`],
  }),
}

async function conditions(live: LiveGpu): Promise<Record<AlertKey, Condition>> {
  const since = new Date(Date.now() - THRESHOLDS.errorRateWindowMin * 60_000)
  const [total, failed] = await Promise.all([
    prisma.gideonRun.count({ where: { finishedAt: { gt: since }, status: { in: ["SUCCEEDED", "FAILED"] }, ...modelOutcome() } }),
    prisma.gideonRun.count({ where: { finishedAt: { gt: since }, status: "FAILED", ...modelOutcome() } }),
  ])
  const pct = total ? (failed / total) * 100 : 0
  const g = live.gpu
  const memPct = g?.memUsedMiB != null && g.memTotalMiB ? (g.memUsedMiB / g.memTotalMiB) * 100 : null
  const sustain = THRESHOLDS.sustainMin * 60_000
  const gb = (mib: number | null | undefined) => (mib == null ? "?" : (mib / 1024).toFixed(1))
  return {
    model0_down: { on: !!live.engine && !live.engine.up, sustainMs: THRESHOLDS.model0DownMin * 60_000, value: null, vars: { min: THRESHOLDS.model0DownMin } },
    error_rate: {
      on: total >= THRESHOLDS.errorRateMinAnswers && pct > THRESHOLDS.errorRatePct, sustainMs: 0,
      value: total ? `${Math.round(pct)}% (${failed}/${total})` : null, vars: { pct: Math.round(pct), failed, total },
    },
    vram_full: { on: memPct != null && memPct >= THRESHOLDS.vramFullPct, sustainMs: sustain, value: memPct != null ? `${Math.round(memPct)}%` : null, vars: { used: gb(g?.memUsedMiB), total: gb(g?.memTotalMiB), min: THRESHOLDS.sustainMin } },
    gpu_hot: { on: g?.tempC != null && g.tempC >= THRESHOLDS.gpuHotC, sustainMs: sustain, value: g?.tempC != null ? `${Math.round(g.tempC)}°C` : null, vars: { temp: g?.tempC != null ? Math.round(g.tempC) : "?", limit: THRESHOLDS.gpuHotC, min: THRESHOLDS.sustainMin } },
  }
}

/**
 * Advance each alert with this sample and notify the One Above All on a new episode or its recovery. One process
 * at a time (transaction-level advisory lock on the state row's read-modify-write): two slots receiving samples
 * during a blue-green switch cannot both fire. Never throws.
 */
export async function evaluateAlerts(live: LiveGpu): Promise<AlertView[]> {
  try {
    const cond = await conditions(live)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const toSend: { key: AlertKey; kind: "fire" | "clear"; episode: string; vars: Record<string, string | number>; minutes: number }[] = []
    const state = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4632018908)`
      const row = await tx.appSetting.findUnique({ where: { key: ALERT_STATE_KEY } })
      const s = ((row?.value as unknown as AlertState) ?? {}) as AlertState
      for (const key of ALERT_KEYS) {
        const c = cond[key]
        const e: AlertEntry = s[key] ?? { pendingSince: null, active: false, firedAt: null, clearedAt: null, notified: false, value: null }
        e.value = c.value
        if (c.on) {
          e.pendingSince ??= nowIso
          if (!e.active && now - Date.parse(e.pendingSince) >= c.sustainMs) {
            e.active = true
            e.firedAt = nowIso
            // Flapping: back within 30 min of clearing = the same incident, already told.
            const flap = e.clearedAt && now - Date.parse(e.clearedAt) < FLAP_MS
            e.notified = !flap
            if (!flap) toSend.push({ key, kind: "fire", episode: nowIso, vars: c.vars, minutes: 0 })
          }
        } else {
          if (e.active) {
            if (e.notified) toSend.push({ key, kind: "clear", episode: e.firedAt ?? nowIso, vars: c.vars, minutes: Math.max(1, Math.round((now - Date.parse(e.pendingSince ?? nowIso)) / 60_000)) })
            e.clearedAt = nowIso
          }
          e.active = false
          e.pendingSince = null
        }
        s[key] = e
      }
      const json = s as unknown as Prisma.InputJsonValue
      await tx.appSetting.upsert({ where: { key: ALERT_STATE_KEY }, create: { key: ALERT_STATE_KEY, value: json }, update: { value: json } })
      return s
    })
    if (toSend.length) await notifyOaa(toSend)
    return alertViews(state)
  } catch (error) {
    log.warn("alert evaluation failed", { error: String(error) })
    return []
  }
}

async function notifyOaa(items: { key: AlertKey; kind: "fire" | "clear"; episode: string; vars: Record<string, string | number>; minutes: number }[]) {
  const oaa = await prisma.workspaceMember.findMany({ where: { workspaceId: ORG_WORKSPACE_ID, role: "ONE_ABOVE_ALL" }, select: { userId: true } })
  for (const it of items) {
    const base = ALERT_TEXT[it.key](it.vars)
    const t = it.kind === "fire"
      ? bi(base.en, base.id)
      : bi([`Back to normal: ${base.en[0]}`, `Cleared after ${it.minutes} min.`], [`Sudah normal lagi: ${base.id[0]}`, `Pulih setelah ${it.minutes} menit.`])
    for (const { userId } of oaa) {
      await createInAppNotification({
        userId, type: "GIDEON_ALERT", title: t.title, message: t.message, texts: t.texts,
        link: "/admin?tab=gideon&gideon=performance", push: it.kind === "fire",
        dedupeKey: `gideon-perf|${it.key}|${it.kind}|${it.episode}|${userId}`,
      }).catch((error) => log.warn("alert notification failed", { key: it.key, error: String(error) }))
    }
    log.info("GIDEON perf alert", { key: it.key, kind: it.kind, recipients: oaa.length })
  }
  eventBus.emit(BUS_EVENTS.GIDEON_PERF, { kind: "alerts" })
}
