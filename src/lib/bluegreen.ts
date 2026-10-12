import fs from "fs"
import pg from "pg"
import { createLogger } from "@/lib/logger"
import { setDbPoolStandby } from "@/lib/db-pool"

/**
 * Blue-green slots (12 Oct 2026, deploy/bluegreen/README.md).
 *
 * Production and dev run TWO app containers on the same database: the LIVE slot (nginx sends traffic
 * to it) and the IDLE slot (the next release, or the previous one kept warm for an instant rollback).
 * Both processes boot the same code, so everything that must happen once per system — the automation
 * clock, GIDEON schedules — asks this module first.
 *
 *  - Slot identity: env NEXUS_SLOT ("blue" | "green"). Unset = no blue-green here (the VPS standby, an
 *    old single-container deploy): the process is always "live".
 *  - Which slot is live: the deploy script writes the slot name to a file mounted read-only into both
 *    containers (NEXUS_BLUEGREEN_LIVE_FILE, default /app/data/bluegreen/live) at the moment it switches
 *    nginx. A missing/empty file also means "live", so a broken mount degrades to "both compete".
 *  - Exactly one runner: a session-level Postgres advisory lock held on a dedicated connection (not the
 *    Prisma pool — a pooled connection would take the lock on one connection and test it on another).
 *    Only the leader runs the singletons. The live slot competes for it; the idle slot releases it. A
 *    crash closes the connection, Postgres drops the lock, and the next holder takes over within one
 *    check. If the live slot cannot hold it for STANDBY_TAKEOVER_MS (crash loop, wrong mount), the idle
 *    slot takes it as a fallback for FALLBACK_HOLD_MS, then lets go again, so the clock never stops.
 *  - Demotion: the deploy script sends SIGUSR2 to the slot it just switched away from. The process
 *    re-reads the live file at once (releases the lock) and closes its realtime connections, so open
 *    tabs and apps reconnect through nginx — to the new live slot — instead of staying on a process
 *    that no longer sees the writes (events are in-process; there is no Redis adapter).
 *
 * NEXUS_SINGLETON_LOCK=0 turns the election off (always leader) — the escape hatch, never needed for
 * a single container because a lone process simply wins the lock.
 */

const log = createLogger("bluegreen")

/** pg advisory lock key for "NEXUS singletons" (any constant; only NEXUS uses advisory locks here). */
export const SINGLETON_LOCK_KEY = 4_632_018_812
const CHECK_MS = 5_000
const STANDBY_TAKEOVER_MS = 120_000
const FALLBACK_HOLD_MS = 5 * 60_000

export function slotName(): string | null {
  const s = (process.env.NEXUS_SLOT || "").trim()
  return s || null
}

function liveFile(): string {
  return process.env.NEXUS_BLUEGREEN_LIVE_FILE || "/app/data/bluegreen/live"
}

/** The slot the deploy script last switched nginx to; null when there is no blue-green state. */
export function readLiveSlot(): string | null {
  try {
    return fs.readFileSync(liveFile(), "utf8").trim() || null
  } catch {
    return null
  }
}

/** Pure decision, exported for tests: does a process in slot `me` count as live when the file says `live`? */
export function slotIsLive(me: string | null, live: string | null): boolean {
  if (!me) return true
  return !live || live === me
}

export function isLiveSlot(): boolean {
  return slotIsLive(slotName(), readLiveSlot())
}

type LeaderState = {
  started: boolean
  held: boolean
  fallbackSince: number | null
  freeSince: number | null
  client: pg.Client | null
  busy: boolean
  demotedHandlers: Array<() => void>
  since: number | null
  lastError: string | null
}

const g = globalThis as unknown as { __nexusLeader?: LeaderState }
function state(): LeaderState {
  if (!g.__nexusLeader) {
    g.__nexusLeader = { started: false, held: false, fallbackSince: null, freeSince: null, client: null, busy: false, demotedHandlers: [], since: null, lastError: null }
  }
  return g.__nexusLeader
}

/** True when this process may run the once-per-system work (automation clock, GIDEON schedules). */
export function isSingletonLeader(): boolean {
  if (process.env.NEXUS_SINGLETON_LOCK === "0") return true
  return state().held
}

/** Called when the deploy script demotes this slot (SIGUSR2 while the live file names another slot). */
export function onSlotDemoted(fn: () => void): void {
  state().demotedHandlers.push(fn)
}

async function connect(s: LeaderState): Promise<pg.Client> {
  if (s.client) return s.client
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: `nexus-leader-${slotName() ?? "single"}`,
    connectionTimeoutMillis: 5_000,
  })
  client.on("error", (err) => {
    // The lock lived on this connection; whatever happened, it is gone now.
    if (s.held) log.warn("leader connection lost — lock released", { error: String(err) })
    s.held = false
    s.since = null
    s.fallbackSince = null
    if (s.client === client) s.client = null
    client.end().catch(() => {})
  })
  await client.connect()
  s.client = client
  return client
}

async function tryLock(c: pg.Client): Promise<boolean> {
  const r = await c.query<{ ok: boolean }>("select pg_try_advisory_lock($1::bigint) as ok", [SINGLETON_LOCK_KEY])
  return r.rows[0]?.ok === true
}

async function unlock(c: pg.Client): Promise<void> {
  await c.query("select pg_advisory_unlock($1::bigint)", [SINGLETON_LOCK_KEY])
}

async function check(reason = "tick"): Promise<void> {
  const s = state()
  if (s.busy) return
  s.busy = true
  try {
    const live = isLiveSlot()
    // The idle slot's pool lets idle connections go within seconds (lib/db-pool.ts, realtime bug 3).
    setDbPoolStandby(!live)
    const now = Date.now()
    const c = await connect(s)
    // A read-only replica (the VPS warm standby) runs no clocks at all: nobody leads there. After a
    // promotion the next check takes the lock as usual.
    const ro = await c.query<{ ro: boolean }>("select pg_is_in_recovery() as ro")
    if (ro.rows[0]?.ro) {
      if (s.held) { s.held = false; s.since = null; s.fallbackSince = null }
      s.freeSince = null
      s.lastError = null
      return
    }
    s.lastError = null
    if (s.held) {
      await c.query("select 1") // a dead connection surfaces here (and in the error handler)
      const fallbackOver = s.fallbackSince !== null && now - s.fallbackSince > FALLBACK_HOLD_MS
      if (!live && (s.fallbackSince === null || fallbackOver)) {
        await unlock(c)
        s.held = false
        s.since = null
        s.fallbackSince = null
        s.freeSince = null
        log.info("singleton leadership released", { slot: slotName(), live: readLiveSlot(), reason: fallbackOver ? "fallback-over" : reason })
      } else if (live && s.fallbackSince !== null) {
        s.fallbackSince = null // the deploy made this slot live while it was the fallback: it simply stays
      }
      return
    }
    const got = await tryLock(c)
    if (!got) {
      s.freeSince = null
      return
    }
    if (live) {
      s.held = true
      s.since = now
      s.freeSince = null
      log.info("singleton leadership acquired", { slot: slotName(), reason })
      return
    }
    // Idle slot and nobody holds the lock. Normal for a few seconds around a switch; if it lasts, the
    // live slot is not running its clock (crash loop) and this slot covers for it for a while.
    s.freeSince ??= now
    if (now - s.freeSince >= STANDBY_TAKEOVER_MS) {
      s.held = true
      s.since = now
      s.fallbackSince = now
      log.warn("singleton leadership taken by the IDLE slot as a fallback", { slot: slotName(), live: readLiveSlot(), freeForMs: now - s.freeSince })
    } else {
      await unlock(c)
    }
  } catch (err) {
    // Logged once per distinct failure, not every 5 s while the database is away.
    if (s.lastError !== String(err)) log.warn("leader check failed", { error: String(err) })
    s.lastError = String(err)
    if (s.client) {
      const c = s.client
      s.client = null
      c.end().catch(() => {})
    }
    s.held = false
    s.since = null
    s.fallbackSince = null
  } finally {
    s.busy = false
  }
}

/** Leader snapshot for /api/health and the deploy script's status output. */
export function leaderInfo(): { slot: string | null; live: boolean; leader: boolean } {
  return { slot: slotName(), live: isLiveSlot(), leader: isSingletonLeader() }
}

/** Start the election once per process (instrumentation.ts). Safe to call more than once. */
export function startSingletonLeader(): void {
  const s = state()
  if (s.started) return
  s.started = true
  if (process.env.NEXUS_SINGLETON_LOCK === "0") {
    log.info("singleton election off (NEXUS_SINGLETON_LOCK=0): this process always leads")
    return
  }
  void check("boot")
  setInterval(() => { void check() }, CHECK_MS).unref?.()
  process.on("SIGUSR2", () => {
    const live = isLiveSlot()
    setDbPoolStandby(!live)
    log.info("SIGUSR2 from the deploy script", { slot: slotName(), live: readLiveSlot(), thisSlotLive: live })
    void check("signal")
    if (live) return
    for (const fn of s.demotedHandlers) {
      try { fn() } catch (err) { log.warn("demotion handler failed", { error: String(err) }) }
    }
  })
}
