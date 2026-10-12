import type pg from "pg"

/**
 * The process's Postgres pool settings and its blue-green "standby" mode (realtime bug 3, 13 Oct 2026).
 *
 * Budget (deploy/bluegreen/RUNBOOK.md "Connections"): two slots run side by side on one database, each ONE
 * pool (lib/prisma.ts caches the client on globalThis) of at most DB_POOL_MAX, plus one leader connection
 * per slot (lib/bluegreen.ts). The IDLE slot (the previous release kept warm for a rollback, or the next one
 * before its switch) gets no traffic, so in standby its pool lets idle connections go after
 * DB_IDLE_TIMEOUT_STANDBY (default 2 s) instead of DB_IDLE_TIMEOUT: a slot that was just switched away from
 * hands its connections back within seconds of finishing its last requests. `max` is never lowered — the
 * slot about to become live must not start its first seconds of traffic behind a tiny pool.
 *
 * No imports beyond types: lib/bluegreen.ts (which decides the mode) must not pull in Prisma.
 */
const g = globalThis as unknown as { __nexusDbPools?: Set<pg.Pool>; __nexusDbPoolStandby?: boolean }
const pools = (g.__nexusDbPools ??= new Set())

const int = (v: string | undefined, fallback: number) => {
  const n = parseInt(v ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
export const dbPoolMax = () => int(process.env.DB_POOL_MAX, 20)
export const dbIdleTimeoutMs = () => int(process.env.DB_IDLE_TIMEOUT, 30_000)
const standbyIdleMs = () => int(process.env.DB_IDLE_TIMEOUT_STANDBY, 2_000)

export function registerDbPool(pool: pg.Pool): void {
  pools.add(pool)
  if (g.__nexusDbPoolStandby) applyMode(pool, true)
}

function applyMode(pool: pg.Pool, standby: boolean) {
  // pg-pool reads options.idleTimeoutMillis each time a client is released, so this takes effect at once
  // for every connection handed back from now on.
  ;(pool as unknown as { options: { idleTimeoutMillis: number } }).options.idleTimeoutMillis = standby ? standbyIdleMs() : dbIdleTimeoutMs()
}

/** lib/bluegreen.ts, every leader check (5 s) and on SIGUSR2: live → normal pool, idle slot → standby. */
export function setDbPoolStandby(standby: boolean): void {
  if (g.__nexusDbPoolStandby === standby) return
  g.__nexusDbPoolStandby = standby
  for (const pool of pools) applyMode(pool, standby)
}

/** For /api/health and the deploy status: what this process holds right now. */
export function dbPoolStats(): { pools: number; total: number; idle: number; waiting: number; max: number; standby: boolean } {
  let total = 0, idle = 0, waiting = 0
  for (const p of pools) { total += p.totalCount; idle += p.idleCount; waiting += p.waitingCount }
  return { pools: pools.size, total, idle, waiting, max: dbPoolMax(), standby: !!g.__nexusDbPoolStandby }
}
