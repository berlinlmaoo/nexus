/**
 * The GIDEON shim restarting is not GIDEON failing (owner, 18 Oct 2026).
 *
 * Restarting the shim on the agents VM (a deploy, a config change) used to kill every answer in flight; NEXUS
 * recorded each as FAILED "shim 502" / "terminated" and Control Room › GIDEON › Performance then called a healthy
 * tier Unavailable. The shim now drains on SIGTERM (integrations/gideon/shim/codex-oracle-shim.js): answers in flight
 * finish, new requests get 503 {"error":"shim_restarting"} with `x-gideon-shim: restarting` and Retry-After.
 *
 * Here, for every NEXUS caller of the shim:
 *  - `fetchShim` retries ONCE, after a short wait, when nothing can have run yet: the shim said it is restarting,
 *    the connection was refused, or (stream endpoints only, whose headers go out before the model starts) the
 *    connection broke before an answer began; the dev relay's own 502 counts as refused.
 *  - whatever still fails that way is recorded as `shim_restart`, a failure kind the Performance panel and its
 *    alerts leave out of the error rate (shown as a separate "restarts" count), like `model0_unavailable`.
 * No imports on purpose: unit-tested with plain node (gideon-shim-retry.test.mjs).
 */

export const SHIM_RESTART = "shim_restart"
export const MODEL0_UNAVAILABLE = "model0_unavailable"
/** Failure kinds that are not the model failing: left out of error rates, the "last 3 failed" rule and alerts. */
export const NON_MODEL_FAILURES: readonly string[] = [MODEL0_UNAVAILABLE, SHIM_RESTART]

export function isNonModelFailure(error: string | null | undefined): boolean {
  return !!error && NON_MODEL_FAILURES.includes(error)
}

type HeaderBag = { get(name: string): string | null }

/** The shim's own "I am restarting" answer (old shims never send it). */
export function isShimRestartResponse(status: number, headers: HeaderBag | null | undefined): boolean {
  return status === 503 && (headers?.get("x-gideon-shim") || "").toLowerCase() === "restarting"
}

/** A run the shim stopped at its drain cap (it had started: recorded as `shim_restart`, never retried). */
export function isShimStoppedResponse(status: number, headers: HeaderBag | null | undefined): boolean {
  return status === 503 && (headers?.get("x-gideon-shim") || "").toLowerCase() === "stopped"
}

/** A gateway error with no shim behind it: the dev relay (nginx) answering 502/504 while the shim is down. */
export function isGatewayDown(status: number, headers: HeaderBag | null | undefined): boolean {
  return (status === 502 || status === 504) && !headers?.get("x-gideon-shim")
}

/**
 * How a fetch / body read broke: `refused` = never connected (nothing ran), `dropped` = the socket closed under us.
 * Timeouts and aborts are neither (the caller gave up; that is not a restart).
 */
export function connectionDropKind(err: unknown): "refused" | "dropped" | null {
  if (!err || typeof err !== "object") return null
  const e = err as { name?: string; message?: string; code?: string; cause?: unknown }
  if (e.name === "AbortError" || e.name === "TimeoutError") return null
  const cause = (e.cause && typeof e.cause === "object" ? e.cause : {}) as { code?: string; message?: string; name?: string }
  if (cause.name === "AbortError" || cause.name === "TimeoutError") return null
  const code = String(cause.code || e.code || "")
  if (["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND"].includes(code)) return "refused"
  if (["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED", "ECONNABORTED"].includes(code)) return "dropped"
  const msg = `${e.message || ""} ${cause.message || ""}`.toLowerCase()
  if (/terminated|other side closed|socket hang up|socket closed/.test(msg)) return "dropped"
  return null
}

/** Wait before the one retry: the shim's Retry-After, kept between 1 s and 6 s (a person is waiting). */
export function retryDelayMs(retryAfter: string | null | undefined): number {
  const s = Number(retryAfter)
  if (!retryAfter || !Number.isFinite(s)) return 2000
  return Math.min(6000, Math.max(1000, Math.round(s * 1000)))
}

/**
 * Did the shim restart since `sinceMs`? Its /health says so: `x-gideon-shim: draining`, or a start time after the
 * request began. An old shim (no headers) or one that stays down reads as no.
 */
export async function shimRestartedSince(url: string, sinceMs: number, opts: { tries?: number; gapMs?: number; fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const f = opts.fetchImpl ?? fetch
  let health: string
  try {
    health = new URL("/health", url).toString()
  } catch {
    return false
  }
  const tries = opts.tries ?? 3
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(opts.gapMs ?? 1500)
    try {
      const r = await f(health, { signal: AbortSignal.timeout(2000) })
      const state = (r.headers.get("x-gideon-shim") || "").toLowerCase()
      const started = Date.parse(r.headers.get("x-gideon-shim-started") || "")
      await r.body?.cancel().catch(() => {})
      if (state === "draining" || state === "restarting") return true
      if (Number.isFinite(started)) return started >= sinceMs - 1000
      if (r.ok) return false
    } catch {
      /* down right now: try again */
    }
  }
  return false
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class ShimRestartError extends Error {
  constructor(message = SHIM_RESTART) {
    super(message)
    this.name = "ShimRestartError"
  }
}

export type ShimFetchResult = {
  res: Response
  /** The final answer is the shim (still) restarting: record the run as `shim_restart`. */
  restarting: boolean
  retried: boolean
}

/**
 * POST to the shim with the one transparent retry described above. Throws what fetch throws, except that a broken
 * connection the shim's /health explains as a restart is rethrown as ShimRestartError.
 * `stream`: the endpoint answers headers before the model starts (/chat-stream), so a broken connection before the
 * response means nothing ran and may be retried; for /chat it may have been mid-answer, so only "refused" retries.
 */
export async function fetchShim(url: string, init: RequestInit, opts: { stream: boolean; fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void>; healthTries?: number } = { stream: false }): Promise<ShimFetchResult> {
  const f = opts.fetchImpl ?? fetch
  const wait = opts.sleepImpl ?? sleep
  const t0 = Date.now()
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await f(url, init)
    } catch (error) {
      const kind = connectionDropKind(error)
      if (attempt === 0 && (kind === "refused" || (kind === "dropped" && opts.stream))) {
        await wait(retryDelayMs(null))
        continue
      }
      if (kind && (await shimRestartedSince(url, t0, { fetchImpl: f, tries: opts.healthTries }))) throw new ShimRestartError()
      throw error
    }
    const restarting = isShimRestartResponse(res.status, res.headers)
    const gateway = isGatewayDown(res.status, res.headers) && opts.stream
    if (attempt === 0 && (restarting || gateway)) {
      await res.body?.cancel().catch(() => {})
      await wait(retryDelayMs(res.headers.get("retry-after")))
      continue
    }
    return { res, restarting: restarting || isShimStoppedResponse(res.status, res.headers) || (isGatewayDown(res.status, res.headers) && (await shimRestartedSince(url, t0, { fetchImpl: f, tries: opts.healthTries }))), retried: attempt > 0 }
  }
}

/**
 * The failure kind to record for a broken stream read / thrown shim call: `shim_restart` when it was the shim
 * restarting, else the error's own message.
 */
export async function shimFailureKind(error: unknown, url: string, sinceMs: number, fetchImpl?: typeof fetch): Promise<string> {
  if (error instanceof ShimRestartError || (error as { name?: string })?.name === "ShimRestartError") return SHIM_RESTART
  const msg = error instanceof Error ? error.message : "error"
  if (connectionDropKind(error) && (await shimRestartedSince(url, sinceMs, { fetchImpl }))) return SHIM_RESTART
  return msg
}

/** What the person is told when the answer was lost to a restart (never "error 503"). */
export const SHIM_RESTART_TEXT = {
  en: "GIDEON is restarting. Try again in a moment.",
  id: "GIDEON lagi dimulai ulang. Coba lagi sebentar lagi ya.",
} as const
