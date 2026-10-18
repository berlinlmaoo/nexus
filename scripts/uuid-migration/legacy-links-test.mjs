// Old links keep working after the UUIDv7 conversion (docs/internal/UUID-MIGRATION.md). Two phases around
// a real conversion of a COPY database, against a candidate app pointed at that copy:
//
//   BASE=http://… QA_EMAIL=… QA_PW_FILE=… STATE=/tmp/legacy.json node legacy-links-test.mjs before
//   (stop app, convert.sql, verify.sql, start app)
//   BASE=http://… QA_EMAIL=… QA_PW_FILE=… STATE=/tmp/legacy.json node legacy-links-test.mjs after
//
// "before" signs in (the JWT now carries the OLD user id, like every phone and browser at the window) and
// records old ids the account can see. "after" replays them with that OLD session and checks every path an
// old id comes back through: the JWT, REST paths, query cursors, the SPA link resolver, file URLs, the
// realtime handshake and room join, plus a fresh row minted as UUIDv7. Never prints secrets. Exit 1 on failure.
import { readFileSync, writeFileSync } from "node:fs"

const BASE = (process.env.BASE || "http://127.0.0.1:3000").replace(/\/$/, "")
const EMAIL = process.env.QA_EMAIL || ""
const PW = process.env.QA_PW_FILE ? readFileSync(process.env.QA_PW_FILE, "utf8").trim() : ""
const STATE = process.env.STATE || "/tmp/legacy-links.json"
const PHASE = process.argv[2]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const H = { "X-Nexus-Client": "web/1" }
let failed = 0
const rec = (name, ok, detail = "") => {
  if (!ok) failed++
  console.log(`   ${ok ? "ok  " : "FAIL"} ${name}${detail ? "  — " + detail : ""}`)
}
async function req(path, { cookie, method = "GET", body, redirect = "manual" } = {}) {
  const r = await fetch(BASE + path, {
    method,
    redirect,
    headers: { ...H, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, json, text, headers: r.headers }
}
async function login() {
  const r = await req("/api/auth/app-login", { method: "POST", body: { email: EMAIL, password: PW } })
  if (r.status !== 200 || !r.json?.token) throw new Error(`login HTTP ${r.status}`)
  return { cookie: `${r.json.cookieName}=${r.json.token}`, userId: r.json.user?.id }
}
const pick = (list) => (Array.isArray(list) ? list : list?.projects ?? list?.items ?? list?.data ?? list?.conversations ?? [])

if (PHASE === "before") {
  const { cookie, userId } = await login()
  const projects = pick((await req("/api/projects", { cookie })).json)
  let project = null
  let taskId = null
  for (const p of projects.filter((x) => x?.id).slice(0, 25)) {
    const t = (await req(`/api/tasks?projectId=${p.id}`, { cookie })).json
    const first = pick(t?.tasks ?? t).find((x) => x?.id)
    if (first) { project = p; taskId = first.id; break }
  }
  const convs = pick((await req("/api/conversations", { cookie })).json)
  const conv = convs.find((c) => c?.id) ?? null
  let messageId = null
  if (conv) {
    const m = (await req(`/api/conversations/${conv.id}/messages`, { cookie })).json
    messageId = (m?.messages ?? m ?? [])[0]?.id ?? null
  }
  const state = { cookie, userId, projectId: project?.id ?? null, taskId, conversationId: conv?.id ?? null, messageId }
  writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 })
  rec("before: signed in with an old-format id", !!userId && !UUID.test(userId), `user ${userId?.slice(0, 4)}…`)
  rec("before: found a project / task / conversation", !!state.projectId && !!state.taskId && !!state.conversationId,
    `project ${!!state.projectId} task ${!!state.taskId} conversation ${!!state.conversationId} message ${!!messageId}`)
} else if (PHASE === "after") {
  const s = JSON.parse(readFileSync(STATE, "utf8"))
  const old = s.cookie // a JWT minted BEFORE the conversion: token.id is the old user id
  const ids = (await req(`/api/legacy-ids?ids=${[s.userId, s.projectId, s.taskId, s.conversationId, s.messageId].filter(Boolean).join(",")}`, { cookie: old })).json?.ids ?? {}
  rec("old session still signed in (legacy-ids answers)", Object.keys(ids).length > 0, `${Object.keys(ids).length} ids mapped`)
  const sess = await req("/api/auth/session", { cookie: old })
  rec("old JWT -> session.user.id is the NEW UUIDv7", UUID.test(sess.json?.user?.id ?? "") && sess.json.user.id === ids[s.userId], sess.json?.user?.id?.slice(0, 13))
  for (const path of ["/api/projects", "/api/conversations", "/api/notifications", "/api/app/config"]) {
    const r = await req(path, { cookie: old })
    rec(`old session GET ${path}`, r.status === 200, `HTTP ${r.status}`)
  }
  if (s.projectId) {
    const r = await req(`/api/projects/${s.projectId}`, { cookie: old })
    const id = r.json?.id ?? r.json?.project?.id
    rec("GET /api/projects/<OLD id> -> the project, under its new id", r.status === 200 && id === ids[s.projectId], `HTTP ${r.status}`)
  }
  if (s.taskId) {
    const r = await req(`/api/tasks/${s.taskId}`, { cookie: old })
    const id = r.json?.id ?? r.json?.task?.id
    rec("GET /api/tasks/<OLD id>", r.status === 200 && id === ids[s.taskId], `HTTP ${r.status}`)
    const c = await req(`/api/tasks/${s.taskId}/comments`, { cookie: old, method: "POST", body: { content: "uuid migration test comment" } })
    const cid = c.json?.id ?? c.json?.comment?.id
    rec("POST a comment on an OLD task id -> new row id is UUIDv7", (c.status === 200 || c.status === 201) && UUID.test(cid ?? ""), `HTTP ${c.status} ${String(cid).slice(0, 15)}`)
  }
  if (s.conversationId) {
    const q = s.messageId ? `?after=${s.messageId}` : ""
    const r = await req(`/api/conversations/${s.conversationId}/messages${q}`, { cookie: old })
    rec(`GET conversation messages (OLD conversation id${s.messageId ? " + after=<OLD message id>" : ""})`, r.status === 200, `HTTP ${r.status}`)
  }
  if (s.projectId && s.taskId) {
    const r = await req(`/api/legacy-ids?path=${encodeURIComponent(`/projects/${s.projectId}/tasks/${s.taskId}?tab=x`)}`, { cookie: old })
    rec("SPA link resolver: old /projects/<id>/tasks/<id> -> new", r.json?.path === `/projects/${ids[s.projectId]}/tasks/${ids[s.taskId]}?tab=x`, r.json?.path?.slice(0, 30))
  }
  {
    // File URLs carry cuid / 32-hex ids (the shapes real rows have); a hand-made id like a QA seed's is not
    // looked for inside paths. Use whichever of the user / project ids has such a shape.
    const shaped = (id) => /^(c[a-z0-9]{24}|[0-9a-f]{32})$/.test(id ?? "")
    const target = shaped(s.userId) ? ["avatars", s.userId, ".jpg"] : shaped(s.projectId) ? ["project-icons", s.projectId, ".png"] : null
    if (target) {
      const r = await req(`/api/files/${target[0]}/${target[1]}${target[2]}?t=1`, { cookie: old })
      rec(`old ${target[0]} file URL -> 308 to the renamed file`, r.status === 308 && r.headers.get("location") === `/api/files/${target[0]}/${ids[target[1]]}${target[2]}?t=1`, `HTTP ${r.status}`)
    } else rec("file URL redirect", false, "no cuid/hex id to test with")
  }
  // realtime: handshake with the OLD cookie, then join the project room by its OLD id
  {
    const init = await req("/api/realtime-init", { cookie: old })
    rec("realtime-init (old session)", init.status === 204 || init.status === 200, `HTTP ${init.status}`)
    const eio = (q) => `${BASE}/api/socket/?EIO=4&transport=polling&t=${Date.now()}${q}`
    const h = await fetch(eio(""), { headers: { Cookie: old }, signal: AbortSignal.timeout(10000) })
    const hs = await h.text()
    if (h.status === 200 && hs[0] === "0") {
      const sid = JSON.parse(hs.slice(1)).sid
      const post = (body) => fetch(eio(`&sid=${sid}`), { method: "POST", headers: { Cookie: old, "Content-Type": "text/plain;charset=UTF-8" }, body, signal: AbortSignal.timeout(10000) })
      const packets = []
      const poll = async () => {
        const r = await fetch(eio(`&sid=${sid}`), { headers: { Cookie: old }, signal: AbortSignal.timeout(30000) })
        for (const p of (await r.text()).split("\x1e")) { if (p === "2") await post("3"); else packets.push(p) }
      }
      await post("40")
      await poll()
      const connected = packets.some((p) => p.startsWith("40"))
      rec("socket connect with the OLD JWT", connected, packets.join("|").slice(0, 60))
      if (connected && s.projectId) {
        await post(`42${JSON.stringify(["join-room", { room: `project:${s.projectId}`, userId: s.userId, name: "t" }])}`)
        const deadline = Date.now() + 10000
        while (Date.now() < deadline && !packets.some((p) => p.includes("presence-update") || p.includes("join-denied"))) await poll()
        const joined = packets.some((p) => p.includes("presence-update")) && !packets.some((p) => p.includes("join-denied"))
        rec("join-room project:<OLD id> accepted", joined, joined ? "" : packets.join("|").slice(0, 90))
        // The proof that the socket sits in the room the server broadcasts to (project:<NEW id>): change the
        // task through REST and wait for its realtime event on this socket.
        if (joined && s.taskId) {
          packets.length = 0
          const cur = (await req(`/api/tasks/${ids[s.taskId]}`, { cookie: old })).json
          const title = (cur?.title ?? cur?.task?.title ?? "task") + " ·"
          const u = await req(`/api/tasks/${s.taskId}`, { cookie: old, method: "PATCH", body: { title } })
          const until = Date.now() + 10000
          while (Date.now() < until && !packets.some((p) => p.includes(ids[s.taskId]))) await poll()
          const got = packets.find((p) => p.includes(ids[s.taskId]))
          rec("PATCH task by OLD id -> realtime event reaches the socket that joined by OLD project id", u.status === 200 && !!got, `PATCH ${u.status} ${got ? got.slice(0, 40) : packets.join("|").slice(0, 80)}`)
        }
      }
      await post("41").catch(() => {})
    } else rec("socket handshake (old session)", false, `HTTP ${h.status}`)
  }
  const fresh = await login()
  rec("fresh sign-in -> UUIDv7 user id", UUID.test(fresh.userId ?? "") && fresh.userId === ids[s.userId], fresh.userId?.slice(0, 13))
} else {
  console.log("usage: legacy-links-test.mjs before|after")
  process.exit(2)
}
console.log(`   legacy-links ${PHASE}: ${failed ? failed + " FAILED" : "all ok"}`)
process.exit(failed ? 1 : 0)
