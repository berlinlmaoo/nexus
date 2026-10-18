// GIDEON shim: graceful restart (owner-approved, 18 Oct 2026). Loaded BEFORE the shim:
//   node --require /path/gideon-shim-graceful.js /path/codex-oracle-shim.js
// It is a separate file on purpose: the shim itself is edited often, and this must survive those edits untouched.
//
// Why: a restart used to kill every answer in flight (systemd's SIGTERM reached the Hermes children too); NEXUS
// recorded each as FAILED "shim 502" / "terminated" and Control Room › GIDEON › Performance called a healthy tier
// Unavailable.
//
// What it does, without touching the shim's code:
//  - SIGTERM / SIGINT start a drain. New POSTs get 503 {"error":"shim_restarting"} with `x-gideon-shim: restarting`
//    and Retry-After (NEXUS retries once, then records `shim_restart`, which is not a model error).
//  - Answers in flight run to their end: hosted tiers at most GIDEON_DRAIN_MS (120 s) after the signal, Model 0
//    (`"model":"experimental"`, children on provider ollama-local) up to GIDEON_DRAIN_M0_MS (425 s) after it started.
//    The process exits as soon as the last one is done.
//  - A run still going at its cap is stopped: a stream gets the line {"t":"error","c":"shim_restart"}, /chat gets
//    503 {"error":"shim_restart"} with `x-gideon-shim: stopped` (already started: NEXUS records it, never retries).
//  - GET /health keeps answering 200 "ok" (monitors stay green) and adds `x-gideon-shim: ready|draining` and
//    `x-gideon-shim-started` (NEXUS uses them to tell a restart from a real failure after a broken connection).
// The unit needs KillMode=mixed (SIGTERM to node only, not the children) and TimeoutStopSec >= 460
// (integrations/gideon/shim/systemd/graceful-restart.conf).
"use strict"
const http = require("http")
const cp = require("child_process")

const NAME = process.env.GIDEON_SHIM_NAME || "gideon-shim"
const STARTED_AT = new Date().toISOString()
const DRAIN_MS = parseInt(process.env.GIDEON_DRAIN_MS || "120000", 10)
const DRAIN_M0_MS = parseInt(process.env.GIDEON_DRAIN_M0_MS || "425000", 10)
let drainingSince = 0
const flights = new Set() // { res, started, tier, stream, capped }
const children = new Set()

// ── Children: every spawn the shim makes (Hermes, the streaming runner, codex) ─────────────────────────────
const isM0Child = (args) => Array.isArray(args) && args.some((a) => String(a) === "ollama-local")
const origSpawn = cp.spawn
cp.spawn = function gracefulSpawn(cmd, args, opts) {
  const child = origSpawn.apply(this, arguments)
  child.gideonM0 = isM0Child(args)
  child.gideonStarted = Date.now()
  children.add(child)
  const done = () => { children.delete(child); if (drainingSince) setImmediate(drainTick) }
  child.once("close", done)
  child.once("error", done)
  return child
}
const childDeadline = (c) => (c.gideonM0 ? c.gideonStarted + DRAIN_M0_MS : drainingSince + DRAIN_MS)
// A request is capped no later than its child (answered "stopped" first, then the child is killed), never after.
const flightDeadline = (f) => (f.tier === "experimental" ? f.started + DRAIN_M0_MS : drainingSince + DRAIN_MS)

function retryAfterSec() {
  let until = drainingSince + Math.min(DRAIN_MS, 30000)
  for (const c of children) until = Math.max(until, childDeadline(c))
  return Math.max(1, Math.min(440, Math.ceil((until - Date.now()) / 1000)))
}

// ── Requests ──────────────────────────────────────────────────────────────────────────────────────────────
function wrapHandler(handler) {
  return function gracefulHandler(req, res) {
    if (req.method === "GET" && req.url === "/health") {
      try {
        res.setHeader("x-gideon-shim", drainingSince ? "draining" : "ready")
        res.setHeader("x-gideon-shim-started", STARTED_AT)
      } catch {}
      return handler.call(this, req, res)
    }
    if (req.method === "POST" && drainingSince) {
      res.writeHead(503, { "Content-Type": "application/json", "Retry-After": String(retryAfterSec()), "x-gideon-shim": "restarting", Connection: "close" })
      return res.end(JSON.stringify({ error: "shim_restarting" }))
    }
    if (req.method === "POST") {
      const f = { res, started: Date.now(), tier: "", stream: String(req.url || "").startsWith("/chat-stream"), capped: false }
      // Peek at the tier without consuming the body (a second 'data' listener sees the same chunks).
      let head = ""
      req.on("data", (c) => { if (!f.tier && head.length < 4096) { head += c; const m = head.match(/"model"\s*:\s*"([a-z]+)"/i); if (m) f.tier = m[1].toLowerCase() } })
      flights.add(f)
      res.once("close", () => { flights.delete(f); if (drainingSince) setImmediate(drainTick) })
    }
    return handler.call(this, req, res)
  }
}
const origCreateServer = http.createServer
http.createServer = function gracefulCreateServer(...args) {
  const i = args.findIndex((a) => typeof a === "function")
  if (i >= 0) args[i] = wrapHandler(args[i])
  return origCreateServer.apply(this, args)
}

// ── Drain ─────────────────────────────────────────────────────────────────────────────────────────────────
function capFlight(f) {
  f.capped = true
  const res = f.res
  try {
    if (f.stream) {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "application/x-ndjson" })
      res.write(JSON.stringify({ t: "error", c: "shim_restart" }) + "\n")
      res.end()
    } else if (!res.headersSent) {
      res.writeHead(503, { "Content-Type": "application/json", "x-gideon-shim": "stopped" })
      res.end(JSON.stringify({ error: "shim_restart" }))
    } else {
      res.end()
    }
  } catch {}
  // The shim will still try to answer this request when its child closes: let that be a no-op, not a throw.
  res.writeHead = function () { return res }
  res.write = function () { return true }
  res.end = function () { return res }
}

function drainTick() {
  const now = Date.now()
  for (const f of flights) if (!f.capped && now >= flightDeadline(f)) capFlight(f)
  for (const c of children) {
    if (!c.gideonCapped && now >= childDeadline(c)) {
      c.gideonCapped = true
      console.log(`[${NAME}] drain cap: stopping a ${c.gideonM0 ? "Model 0" : "hosted"} run after ${Math.round((now - c.gideonStarted) / 1000)}s`)
      try { c.kill("SIGKILL") } catch {}
    }
  }
  if (!flights.size && !children.size) {
    console.log(`[${NAME}] drained in ${Math.round((now - drainingSince) / 1000)}s, exiting`)
    process.exit(0)
  }
}

function startDrain(sig) {
  if (drainingSince) return
  drainingSince = Date.now()
  console.log(`[${NAME}] ${sig}: draining ${flights.size} request(s) / ${children.size} run(s); new requests get 503 shim_restarting`)
  setInterval(drainTick, 500)
  // Backstop: nothing outlives the longest cap, whatever happens.
  setTimeout(() => { console.error(`[${NAME}] drain backstop, exiting with ${children.size} run(s) left`); process.exit(0) }, Math.max(DRAIN_MS, DRAIN_M0_MS) + 20000)
  drainTick()
}
process.on("SIGTERM", () => startDrain("SIGTERM"))
process.on("SIGINT", () => startDrain("SIGINT"))
