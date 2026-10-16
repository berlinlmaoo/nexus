import pg from "pg"
import { randomUUID } from "crypto"
import { eventBus, setBusPublisher } from "@/lib/event-bus"
import { createLogger } from "@/lib/logger"
import { slotName } from "@/lib/bluegreen"

/**
 * The realtime bus across processes (race audit 16 Oct 2026, M19).
 *
 * Blue-green runs two app processes on one database and nginx sends every request to the live one, but a
 * switch is not instant: in-flight requests finish on the old slot after the switch (their emits used to
 * reach nobody: its sockets were just closed), and tabs stay attached to the old slot until SIGUSR2 closes
 * them while the new slot already serves writes. Without Redis (REDIS_URL is empty everywhere) those events
 * were simply lost; a chat thread then waited for the next unrelated refetch.
 *
 * Every BUS_EVENTS emit (lib/event-bus.ts) is also sent as Postgres NOTIFY on channel `nexus_realtime`, and
 * every process LISTENs and re-emits what the OTHER processes sent (its own come back too and are skipped by
 * origin id). Each socket is attached to one process, so a client hears each event once: from the process
 * that emitted it, or from the bridge in the process it is attached to — never both.
 *
 * One DEDICATED pg connection (not the Prisma pool: LISTEN is per session, and a pooled connection would
 * listen on one connection and be handed to a query on another), the same reason lib/bluegreen.ts and
 * lib/cron-lock.ts keep their own. NOTIFY payloads are limited to 8000 bytes: a payload is split into frames
 * of at most FRAME_CHARS UTF-16 units (≤ 3 UTF-8 bytes each, so a frame stays under ~6 KB) sent inside one
 * transaction, which Postgres delivers together and in order; the receiver joins them. Anything bigger than
 * MAX_FRAMES frames is not bridged (logged): the client's own reconnect/refetch covers it.
 *
 * Wire format of one notification: `<origin>|<seq>|<i>|<n>|<chunk>` where the joined chunks are
 * JSON [event, data]. A read-only replica (the VPS standby) refuses LISTEN/NOTIFY; the bridge then stays off
 * and retries every RETRY_MS. NEXUS_REALTIME_BRIDGE=0 turns it off.
 */

const log = createLogger("realtime-bridge")
export const REALTIME_CHANNEL = "nexus_realtime"
const FRAME_CHARS = 2400
const MAX_FRAMES = 160
const RETRY_MS = 15_000
/** Partial messages older than this are dropped (a frame lost with a dropped connection). */
const PARTIAL_TTL_MS = 30_000

type BridgeState = {
  started: boolean
  origin: string
  client: pg.Client | null
  connecting: boolean
  seq: number
  partial: Map<string, { at: number; n: number; parts: string[]; got: number }>
  sent: number
  received: number
  skipped: number
  lastError: string | null
}

const g = globalThis as unknown as { __nexusRealtimeBridge?: BridgeState }
function state(): BridgeState {
  if (!g.__nexusRealtimeBridge) {
    g.__nexusRealtimeBridge = {
      started: false, origin: randomUUID().slice(0, 12), client: null, connecting: false, seq: 0,
      partial: new Map(), sent: 0, received: 0, skipped: 0, lastError: null,
    }
  }
  return g.__nexusRealtimeBridge
}

/** Split a string into frames of at most `size` UTF-16 units, never between the halves of a surrogate pair. */
export function frames(text: string, size = FRAME_CHARS): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    let end = Math.min(i + size, text.length)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    out.push(text.slice(i, end))
    i = end
  }
  return out.length ? out : [""]
}

/** Parse one notification; null when malformed. */
export function parseFrame(payload: string): { origin: string; seq: string; i: number; n: number; chunk: string } | null {
  const parts: string[] = []
  let at = 0
  for (let k = 0; k < 4; k++) {
    const bar = payload.indexOf("|", at)
    if (bar < 0) return null
    parts.push(payload.slice(at, bar))
    at = bar + 1
  }
  const i = Number(parts[2]), n = Number(parts[3])
  if (!parts[0] || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n || n > MAX_FRAMES) return null
  return { origin: parts[0], seq: parts[1], i, n, chunk: payload.slice(at) }
}

function deliver(s: BridgeState, text: string) {
  let event: unknown, data: unknown
  try { [event, data] = JSON.parse(text) as [unknown, unknown] } catch { return }
  if (typeof event !== "string") return
  s.received++
  try {
    eventBus.deliverRemote(event, data)
  } catch (error) {
    log.warn("remote event listener failed", { event, error: String(error) })
  }
}

function onNotification(s: BridgeState, msg: pg.Notification) {
  if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return
  const f = parseFrame(msg.payload)
  if (!f || f.origin === s.origin) return
  if (f.n === 1) return deliver(s, f.chunk)
  const key = `${f.origin}|${f.seq}`
  const now = Date.now()
  let p = s.partial.get(key)
  if (!p) {
    for (const [k, v] of s.partial) if (now - v.at > PARTIAL_TTL_MS) s.partial.delete(k)
    p = { at: now, n: f.n, parts: new Array(f.n), got: 0 }
    s.partial.set(key, p)
  }
  if (p.parts[f.i] === undefined) { p.parts[f.i] = f.chunk; p.got++ }
  if (p.got === p.n) {
    s.partial.delete(key)
    deliver(s, p.parts.join(""))
  }
}

async function connect(s: BridgeState): Promise<void> {
  if (s.client || s.connecting) return
  s.connecting = true
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: `nexus-realtime-${slotName() ?? "single"}`.slice(0, 63),
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
  })
  const drop = (why: string) => {
    if (s.client === client) {
      s.client = null
      setBusPublisher(null)
      log.warn("realtime bridge connection lost; retrying", { why })
      setTimeout(() => void connect(s), RETRY_MS).unref?.()
    }
    client.end().catch(() => {})
  }
  client.on("error", (err) => drop(String(err)))
  client.on("end", () => drop("ended"))
  client.on("notification", (msg) => onNotification(s, msg))
  try {
    await client.connect()
    await client.query(`LISTEN ${REALTIME_CHANNEL}`)
    s.client = client
    s.lastError = null
    setBusPublisher((event, data) => publish(s, event, data))
    log.info("realtime bridge up", { origin: s.origin, slot: slotName() })
  } catch (error) {
    // A standby replica ("cannot execute LISTEN during recovery"), or the database is away: try again later.
    if (s.lastError !== String(error)) log.warn("realtime bridge unavailable; retrying", { error: String(error) })
    s.lastError = String(error)
    client.end().catch(() => {})
    setTimeout(() => void connect(s), RETRY_MS).unref?.()
  } finally {
    s.connecting = false
  }
}

function publish(s: BridgeState, event: string, data: unknown) {
  const c = s.client
  if (!c) return
  let text: string
  try { text = JSON.stringify([event, data ?? null]) } catch { return }
  const parts = frames(text)
  if (parts.length > MAX_FRAMES) {
    s.skipped++
    log.warn("realtime event too big to bridge; the other slot's clients refetch on their own", { event, chars: text.length })
    return
  }
  const seq = String(++s.seq)
  const head = `${s.origin}|${seq}|`
  const fail = (error: unknown) => { s.lastError = String(error) }
  s.sent++
  if (parts.length === 1) {
    c.query("select pg_notify($1, $2)", [REALTIME_CHANNEL, `${head}0|1|${parts[0]}`]).catch(fail)
    return
  }
  // One transaction: delivered together and in order. Queued back to back on this client, so no other
  // publish lands between them.
  c.query("begin").catch(fail)
  parts.forEach((p, i) => c.query("select pg_notify($1, $2)", [REALTIME_CHANNEL, `${head}${i}|${parts.length}|${p}`]).catch(fail))
  c.query("commit").catch((e) => { fail(e); c.query("rollback").catch(() => {}) })
}

/** Snapshot for /api/health. */
export function realtimeBridgeInfo(): { up: boolean; sent: number; received: number; skipped: number } {
  const s = state()
  return { up: !!s.client, sent: s.sent, received: s.received, skipped: s.skipped }
}

/** Start once per process (instrumentation.ts). */
export function startRealtimeBridge(): void {
  const s = state()
  if (s.started) return
  s.started = true
  if (process.env.NEXUS_REALTIME_BRIDGE === "0") {
    log.info("realtime bridge off (NEXUS_REALTIME_BRIDGE=0)")
    return
  }
  void connect(s)
}
