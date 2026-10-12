// Zero-downtime + realtime check around a blue-green switch (deploy/bluegreen/README.md → Testing).
// Runs in node:22-alpine --network host while a deploy or a rollback happens:
//
//   BASE=http://127.0.0.1:8080 PUBLIC=https://<dev host>:8443 DURATION=240 CONC=6 \
//   QA_EMAIL=… QA_PW_FILE=/run/qa-pw PROJECT_ID=… TASKLIST_ID=… node switch-test.mjs
//
// Load: CONC workers loop over health / SPA / entry bundle / an authenticated read, half of them through
// the public (tailscale serve) URL; fetch keeps connections alive like a browser does. Every non-2xx or
// network error is a failure. The slot behind /api/health is sampled to timestamp the switch.
// Realtime: one websocket client (session cookie) joins project:<id>; every 3 s the test PATCHes a task it
// created in that project and expects the `task-updated` event back. Reconnects like the real client
// (re-joins its room). Reports events missed, reconnects, and the time without realtime.
import { readFileSync } from "node:fs"

const BASE = process.env.BASE || "http://127.0.0.1:8080"
const PUBLIC = process.env.PUBLIC || BASE
const DURATION = Number(process.env.DURATION || 120) * 1000
const CONC = Number(process.env.CONC || 6)
const EMAIL = process.env.QA_EMAIL
const PW = readFileSync(process.env.QA_PW_FILE, "utf8").trim()
const PROJECT = process.env.PROJECT_ID
const TASKLIST = process.env.TASKLIST_ID
const t0 = Date.now()
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6)
const log = (...a) => console.log(`[${ts()}s]`, ...a)

const login = await fetch(BASE + "/api/auth/app-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) }).then((r) => r.json())
if (!login.ok) { console.log("login failed"); process.exit(2) }
const cookie = `${login.cookieName}=${login.token}`
const index = await fetch(BASE + "/").then((r) => r.text())
const entry = index.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0]

// ---------------- load
const stats = { ok: 0, fail: 0, byPath: {}, failures: [] }
const paths = [
  ["/api/health", {}], ["/", {}], [entry, {}], ["/api/projects", { Cookie: cookie }], ["/api/notifications", { Cookie: cookie }],
]
let stop = false
const slotSeen = []
async function worker(i) {
  const base = i % 2 ? PUBLIC : BASE
  let k = i
  while (!stop) {
    const [p, h] = paths[k++ % paths.length]
    try {
      const r = await fetch(base + p, { headers: h, signal: AbortSignal.timeout(20000) })
      const body = await r.arrayBuffer()
      if (r.status >= 200 && r.status < 300) stats.ok++
      else { stats.fail++; stats.failures.push(`${ts()}s ${r.status} ${base === PUBLIC ? "pub" : "loc"} ${p}`) }
      if (p === "/api/health" && r.status === 200) {
        const s = JSON.parse(Buffer.from(body).toString()).slot
        if (slotSeen.at(-1)?.slot !== s) { slotSeen.push({ t: ts(), slot: s }); log(`health now answered by slot ${s}`) }
      }
      stats.byPath[p] = (stats.byPath[p] || 0) + 1
    } catch (e) {
      stats.fail++; stats.failures.push(`${ts()}s ERR ${base === PUBLIC ? "pub" : "loc"} ${p} ${e.cause?.code || e.name}`)
    }
  }
}

// ---------------- realtime
const rt = { sent: 0, got: 0, missed: [], covered: [], reconnects: 0, downSince: null, downMs: 0 }
const pending = new Map()
let ws = null
let connected = false
async function connect() {
  // Like the web/iOS/Android clients: bootstrap the socket server first, then open the websocket.
  await fetch(BASE + "/api/realtime-init", { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) }).catch(() => {})
  const url = BASE.replace(/^http/, "ws") + "/api/socket/?EIO=4&transport=websocket"
  ws = new WebSocket(url, { headers: { Cookie: cookie } })
  ws.onmessage = (ev) => {
    const m = String(ev.data)
    if (m === "2") return ws.send("3")
    if (m.startsWith("0")) return ws.send("40")
    if (m.startsWith("40")) {
      connected = true
      if (rt.downSince) { rt.downMs += Date.now() - rt.downSince; log(`realtime reconnected after ${Date.now() - rt.downSince} ms`); rt.downSince = null }
      ws.send("42" + JSON.stringify(["join-room", { room: `project:${PROJECT}`, userId: login.user.id, name: "bg-test" }]))
      return
    }
    if (m.startsWith("44")) log("socket refused", m)
    if (m.startsWith("42")) {
      const [ev2, data] = JSON.parse(m.slice(2))
      if (ev2 === "task-updated" && data?.title && pending.has(data.title)) {
        rt.got++; pending.delete(data.title)
      }
    }
  }
  ws.onclose = () => {
    if (stop) return
    connected = false
    rt.reconnects++
    rt.downSince ??= Date.now()
    log("realtime connection closed — reconnecting")
    setTimeout(() => { void connect() }, 300 + Math.random() * 700)
  }
  ws.onerror = () => {}
}
await connect()
const created = await fetch(BASE + "/api/tasks", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ title: "bg-switch-test", taskListId: TASKLIST, projectId: PROJECT }) }).then((r) => r.json())
const taskId = created.id || created.task?.id
if (!taskId) { console.log("cannot create test task", JSON.stringify(created).slice(0, 200)); process.exit(2) }
log(`test task ${taskId}; load ${CONC} workers; realtime on project:${PROJECT}`)

// An update whose event was lost while the socket was (re)connecting is what the clients' reconnect
// catch-up refetch is for; only a loss on a socket that stayed connected the whole time is a failure.
function settle(t, p) {
  pending.delete(t)
  const line = `${t} (sent ${((p.at - t0) / 1000).toFixed(1)}s)`
  if (!p.wasConnected || p.rc !== rt.reconnects) rt.covered.push(line)
  else rt.missed.push(line)
}
const workers = Array.from({ length: CONC }, (_, i) => worker(i))
let n = 0
const pinger = setInterval(async () => {
  const title = `bg-switch-test ${++n}`
  pending.set(title, { at: Date.now(), wasConnected: connected, rc: rt.reconnects })
  rt.sent++
  try {
    const r = await fetch(BASE + `/api/tasks/${taskId}`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ title }) })
    if (r.status !== 200) log(`PATCH ${r.status}`)
  } catch (e) { log("PATCH error", e.cause?.code || e.name) }
  for (const [t, p] of pending) if (Date.now() - p.at > 6000) { settle(t, p) }
}, 3000)

await new Promise((r) => setTimeout(r, DURATION))
stop = true
clearInterval(pinger)
await Promise.allSettled(workers)
await new Promise((r) => setTimeout(r, 4000))
for (const [t, p] of pending) settle(t, p)
await fetch(BASE + `/api/tasks/${taskId}`, { method: "DELETE", headers: { Cookie: cookie } }).catch(() => {})
ws?.close()

console.log("\n==== RESULT ====")
console.log(`requests: ${stats.ok + stats.fail}  ok: ${stats.ok}  FAILED: ${stats.fail}`)
for (const f of stats.failures.slice(0, 20)) console.log("   " + f)
console.log("slots seen on /api/health:", slotSeen.map((s) => `${s.slot}@${s.t.trim()}s`).join(" -> "))
console.log(`realtime: sent ${rt.sent} task updates, received ${rt.got}, lost during a reconnect (catch-up refetch covers) ${rt.covered.length}, MISSED on a live socket ${rt.missed.length}, reconnects ${rt.reconnects}, without realtime ${rt.downMs} ms`)
for (const m of rt.covered) console.log("   during reconnect: " + m)
for (const m of rt.missed) console.log("   MISSED " + m)
process.exit(stats.fail || rt.missed.length ? 1 : 0)
