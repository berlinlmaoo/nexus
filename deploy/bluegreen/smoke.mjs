// Blue-green smoke test (deploy/bluegreen/README.md). Runs in node:22-alpine with --network host
// against the nginx PREVIEW listener, i.e. the idle slot behind production routing, before the switch.
//
//   BASE=http://127.0.0.1:3103 EXPECT_SLOT=green QA_EMAIL=… QA_PW_FILE=/run/qa-pw node smoke.mjs
//
// Checks: SPA shell + its entry bundle, /login, /api/health (slot + database), app login (the same
// route the iOS/Android apps use), a few authenticated reads, and a realtime connect (realtime-init,
// Engine.IO handshake with the session cookie, Socket.IO namespace connect, join-room user:<id> ->
// presence-update). Never prints the password or the session token. Exit 1 on any failure.
import { readFileSync } from "node:fs"

const BASE = (process.env.BASE || "http://127.0.0.1:3103").replace(/\/$/, "")
const EXPECT_SLOT = process.env.EXPECT_SLOT || ""
const EMAIL = process.env.QA_EMAIL || ""
const PW = process.env.QA_PW_FILE ? readFileSync(process.env.QA_PW_FILE, "utf8").trim() : ""
const results = []
let failed = 0
const t0 = Date.now()

function rec(name, ok, detail = "") {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`   ${ok ? "ok  " : "FAIL"} ${name}${detail ? "  — " + detail : ""}`)
}

async function get(path, headers = {}) {
  const r = await fetch(BASE + path, { headers, redirect: "manual", signal: AbortSignal.timeout(15000) })
  const body = await r.text()
  return { status: r.status, body, headers: r.headers }
}

async function step(name, fn) {
  try { await fn() } catch (e) { rec(name, false, String(e?.message || e).slice(0, 200)) }
}

let cookie = ""
let userId = ""

await step("SPA /", async () => {
  const r = await get("/")
  const m = r.body.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
  rec("SPA / (index.html)", r.status === 200 && !!m, `HTTP ${r.status}`)
  if (m) {
    const b = await get(m[0])
    rec("SPA entry bundle", b.status === 200 && b.body.length > 1000, `${m[0]} HTTP ${b.status} ${b.body.length} B`)
  }
})
await step("login page", async () => {
  const r = await get("/login")
  rec("login page /login", r.status === 200 && r.body.includes('id="root"'), `HTTP ${r.status}`)
})
await step("health", async () => {
  const r = await get("/api/health")
  let j = {}
  try { j = JSON.parse(r.body) } catch {}
  const slotOk = !EXPECT_SLOT || j.slot === EXPECT_SLOT
  rec("/api/health", r.status === 200 && j.checks?.database === "up" && slotOk, `HTTP ${r.status} slot=${j.slot} db=${j.checks?.database}`)
})

if (!EMAIL || !PW) {
  rec("QA credentials", false, "QA_EMAIL / QA_PW_FILE missing")
} else {
  await step("app login", async () => {
    const r = await fetch(BASE + "/api/auth/app-login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Nexus-Client": "web/1" },
      body: JSON.stringify({ email: EMAIL, password: PW }),
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    const ok = r.status === 200 && j.ok && j.token && j.cookieName
    rec("app login (QA account)", !!ok, `HTTP ${r.status}`)
    if (ok) { cookie = `${j.cookieName}=${j.token}`; userId = j.user?.id || "" }
  })
}

if (cookie) {
  for (const path of ["/api/auth/session", "/api/projects", "/api/conversations", "/api/notifications", "/api/app/config"]) {
    await step(path, async () => {
      const r = await get(path, { Cookie: cookie })
      let ok = r.status === 200
      if (path === "/api/auth/session") {
        try { ok = ok && JSON.parse(r.body)?.user?.email === EMAIL } catch { ok = false }
      }
      rec(`GET ${path}`, ok, `HTTP ${r.status} ${r.body.length} B`)
    })
  }

  await step("realtime", async () => {
    const init = await get("/api/realtime-init", { Cookie: cookie })
    rec("realtime-init", init.status === 204 || init.status === 200, `HTTP ${init.status}`)
    const eio = (q) => `${BASE}/api/socket/?EIO=4&transport=polling&t=${Date.now()}${q}`
    const h = await fetch(eio(""), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) })
    const hs = await h.text()
    if (h.status !== 200 || hs[0] !== "0") { rec("socket handshake", false, `HTTP ${h.status} ${hs.slice(0, 80)}`); return }
    const sid = JSON.parse(hs.slice(1)).sid
    const post = (body) => fetch(eio(`&sid=${sid}`), { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain;charset=UTF-8" }, body, signal: AbortSignal.timeout(10000) })
    await post("40")
    const packets = []
    const poll = async () => {
      const r = await fetch(eio(`&sid=${sid}`), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) })
      const txt = await r.text()
      for (const p of txt.split("\x1e")) {
        if (p === "2") await post("3")
        else packets.push(p)
      }
    }
    await poll()
    const connected = packets.find((p) => p.startsWith("40"))
    const refused = packets.find((p) => p.startsWith("44"))
    rec("socket connect (session cookie)", !!connected && !refused, (connected || refused || packets.join("|")).slice(0, 60))
    if (!connected) return
    await post(`42${JSON.stringify(["join-room", { room: `user:${userId}`, userId, name: "smoke" }])}`)
    const deadline = Date.now() + 10000
    while (Date.now() < deadline && !packets.some((p) => p.includes("presence-update") || p.includes("join-denied"))) await poll()
    const joined = packets.some((p) => p.includes("presence-update"))
    rec("socket join-room user:<me> -> presence-update", joined, joined ? "" : packets.join("|").slice(0, 120))
    await post("41").catch(() => {})
  })
}

console.log(`   smoke: ${results.length - failed}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
process.exit(failed ? 1 : 0)
