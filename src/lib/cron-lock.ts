import pg from "pg"
import { NextResponse } from "next/server"
import { isSingletonLeader } from "@/lib/bluegreen"
import { createLogger } from "@/lib/logger"

/**
 * One run at a time per cron job, across both blue-green slots (race audit M22, 16 Oct 2026).
 *
 * Every host cron goes to the live slot, but two runs of one job still overlap: curl gives up after
 * 30 s (or 120 s) while the server keeps working and the next tick starts another run, a BoD presses
 * "run now" while the timer fires, a failover or a slot switch leaves a run in flight on the old slot.
 * Most jobs check "already sent?" and then send, so an overlap sends twice.
 *
 * The lock is a SESSION-level advisory lock held on a DEDICATED connection for the length of the run —
 * not the Prisma pool (a pooled connection would take the lock on one connection and release it, or
 * test it, on another; the reason lib/bluegreen.ts does the same) and not a transaction (a job runs for
 * minutes and does its own transactions). If the process dies, Postgres closes the connection and the
 * lock goes with it. The two-key form (class, hashtext(name)) keeps cron locks out of the single-key
 * space every other advisory lock in NEXUS uses.
 */

const log = createLogger("cron-lock")
const CRON_LOCK_CLASS = 0x4e58 // "NX"
/** How long a cron request waits for this slot to become leader (just after boot or a slot switch). */
const LEADER_WAIT_MS = 8_000

export type CronLockResult<T> = { ran: true; value: T } | { ran: false }

/**
 * Take the job's lock, or null when another run holds it. The caller must call the returned release
 * (it ends the dedicated connection). For a job that keeps working after its response went out.
 */
export async function acquireCronLock(name: string): Promise<null | (() => Promise<void>)> {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: `nexus-cron-${name}`.slice(0, 63),
    connectionTimeoutMillis: 5_000,
  })
  // A dropped connection releases the lock; the run carries on, and the next tick can start another.
  client.on("error", (err) => log.warn("cron lock connection lost", { name, error: String(err) }))
  await client.connect()
  let held = false
  try {
    const got = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1::int4, hashtext($2)) as ok", [CRON_LOCK_CLASS, name])
    held = got.rows[0]?.ok === true
  } finally {
    if (!held) await client.end().catch(() => {})
  }
  if (!held) return null
  let released = false
  return async () => {
    if (released) return
    released = true
    await client.query("select pg_advisory_unlock($1::int4, hashtext($2))", [CRON_LOCK_CLASS, name]).catch(() => {})
    await client.end().catch(() => {})
  }
}

/** Run `fn` holding the job's lock; { ran: false } when another run holds it. */
export async function withCronLock<T>(name: string, fn: () => Promise<T>): Promise<CronLockResult<T>> {
  const release = await acquireCronLock(name)
  if (!release) return { ran: false }
  try {
    return { ran: true, value: await fn() }
  } finally {
    await release()
  }
}

export async function waitForLeader(ms: number = LEADER_WAIT_MS): Promise<boolean> {
  const until = Date.now() + ms
  while (!isSingletonLeader()) {
    if (Date.now() >= until) return false
    await new Promise((r) => setTimeout(r, 250))
  }
  return true
}

/**
 * The gate every CRON_SECRET route runs its work through:
 *  - a call made with the cron secret runs only on the singleton leader (lib/bluegreen.ts). Right after
 *    boot or a slot switch the live slot can take a few seconds to win the election, so it waits up to
 *    LEADER_WAIT_MS before giving up. A signed-in BoD's "run now" is not gated: it reached this slot
 *    through nginx, and the lock below is what keeps it from overlapping a cron run;
 *  - then the per-job lock above.
 * A skipped run answers 200 { ok: true, skipped }, which the host cron logs as a success.
 */
export const CRON_SKIPPED_NOT_LEADER = { ok: true, skipped: "not_leader" } as const
export const CRON_SKIPPED_RUNNING = { ok: true, skipped: "already_running" } as const

export async function runCronJob(name: string, opts: { fromCron: boolean }, fn: () => Promise<Response>): Promise<Response> {
  if (opts.fromCron && !(await waitForLeader(LEADER_WAIT_MS))) {
    log.info("cron run skipped: not the singleton leader", { name })
    return NextResponse.json(CRON_SKIPPED_NOT_LEADER)
  }
  const r = await withCronLock(name, fn)
  if (!r.ran) {
    log.info("cron run skipped: already running", { name })
    return NextResponse.json(CRON_SKIPPED_RUNNING)
  }
  return r.value
}
