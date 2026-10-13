// Live test of POST /api/collab/edit with a web Yjs client in the same page (12 Oct 2026, iOS editing).
// Run on nexus-prod: put a session cookie (name=value) in /tmp/ct/token, then
//   docker run --rm --network host -v /tmp/ct:/t -v $PWD/scripts/collab-edit-test.mjs:/t/test.mjs:ro -v ~/nexus-dev/apps/web/node_modules:/t/node_modules:ro -w /t node:22-alpine node test.mjs <projectId>
// It creates a page in that project, checks live relay, conflict, keepBoth and persistence, then deletes it.
// Two clients on one page: a "web" Yjs client in the live room, and the app's REST edit (POST /api/collab/edit).
import { io } from "socket.io-client"
import * as Y from "yjs"
import { readFileSync } from "node:fs"

const BASE = "https://nexus-prod.tail765d02.ts.net:8443"
const COOKIE = readFileSync("/t/token", "utf8").trim()
let DOC = ""
const H = { Cookie: COOKIE, "Content-Type": "application/json", "X-Nexus-Client": "ios/0.1.7/14" }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1 }

const getDoc = async () => (await (await fetch(`${BASE}/api/docs/${DOC}`, { headers: H })).json()).doc.content
const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })
const edit = async (base, doc, keepBoth = false) => {
  const r = await fetch(`${BASE}/api/collab/edit`, { method: "POST", headers: H, body: JSON.stringify({ kind: "doc", id: DOC, base, doc, keepBoth }) })
  return { status: r.status, body: await r.json() }
}
const texts = (doc) => doc.content.map((b) => (b.content ?? []).map((c) => c.text ?? "").join(""))

await fetch(`${BASE}/api/realtime-init`, { headers: H }).catch(() => {})
// 0. a fresh page in the QA project (deleted at the end), seeded through the app path (no room open yet).
const made = await (await fetch(`${BASE}/api/docs`, { method: "POST", headers: H, body: JSON.stringify({ title: "ZZ collab edit test", projectId: process.argv[2] }) })).json()
DOC = made.doc?.id ?? made.id
ok(!!DOC, `test page created ${DOC}`)
const start = (await getDoc()) ?? { type: "doc", content: [{ type: "paragraph" }] }
const seed = { type: "doc", content: [P("alpha"), P("bravo"), P("charlie")] }
let r = await edit(start, seed, true)
ok(r.status === 200, `seed via REST (no room open): ${r.status} ${JSON.stringify(r.body.doc ? texts(r.body.doc) : r.body)}`)

// 1. the web client joins the live room.
const sock = io(BASE, { path: "/api/socket", transports: ["websocket"], extraHeaders: { Cookie: COOKIE } })
await new Promise((res, rej) => { sock.on("connect", res); sock.on("connect_error", rej) })
sock.on("ydoc:reset", (d) => console.log("  RESET", JSON.stringify(d)))
sock.on("ydoc:saved", (d) => console.log("  SAVED", d.at))
const ydoc = new Y.Doc()
const join = await sock.emitWithAck("ydoc:join", { room: `doc:${DOC}`, clientId: ydoc.clientID })
ok(join.ok === true, `web client joined the room (canWrite=${join.canWrite})`)
Y.applyUpdate(ydoc, new Uint8Array(join.state), "server")
let received = 0
sock.on("ydoc:update", (d) => { if (d.room === `doc:${DOC}`) { received++; Y.applyUpdate(ydoc, new Uint8Array(d.update), "server") } })
ydoc.on("update", (u, origin) => { if (origin !== "server") sock.emit("ydoc:update", { room: `doc:${DOC}`, update: u }) })
const frag = ydoc.getXmlFragment("default")
const fragTexts = () => frag.toArray().map((el) => el.toArray().map((t) => t.toString()).join(""))
ok(JSON.stringify(fragTexts()) === JSON.stringify(["alpha", "bravo", "charlie"]), `web sees the seed: ${JSON.stringify(fragTexts())}`)

// 2. the app loads, the web types in "charlie", the app edits "alpha" and adds "delta".
const appBase = { type: "doc", content: [P("alpha"), P("bravo"), P("charlie")] }
ydoc.transact(() => { frag.get(2).get(0).insert(7, " (web)") }, "web")
await sleep(600)
r = await edit(appBase, { type: "doc", content: [P("ALPHA (app)"), P("bravo"), P("charlie"), P("delta (app)")] })
ok(r.status === 200, `app edit merged: ${r.status} ${JSON.stringify(texts(r.body.doc ?? { content: [] }))}`)
await sleep(800)
ok(received > 0, `web client got the app's change live (${received} update frames)`)
ok(JSON.stringify(fragTexts()) === JSON.stringify(["ALPHA (app)", "bravo", "charlie (web)", "delta (app)"]), `web document now: ${JSON.stringify(fragTexts())}`)

// 3. conflict: both change "bravo".
const base2 = { type: "doc", content: [P("ALPHA (app)"), P("bravo"), P("charlie (web)"), P("delta (app)")] }
ydoc.transact(() => { frag.get(1).get(0).insert(5, " web2") }, "web")
await sleep(600)
r = await edit(base2, { type: "doc", content: [P("ALPHA (app)"), P("bravo app2"), P("charlie (web)"), P("delta (app)")] })
ok(r.status === 409 && r.body.conflict === true, `same block changed on both sides = 409 (${r.status}, conflicts ${JSON.stringify(r.body.conflicts)})`)
r = await edit(base2, { type: "doc", content: [P("ALPHA (app)"), P("bravo app2"), P("charlie (web)"), P("delta (app)")] }, true)
await sleep(800)
ok(r.status === 200 && JSON.stringify(fragTexts()) === JSON.stringify(["ALPHA (app)", "bravo web2", "bravo app2", "charlie (web)", "delta (app)"]), `keepBoth: ${JSON.stringify(fragTexts())}`)

// 4. persisted: leave the room, read the stored page.
console.log("stored while open:", JSON.stringify(texts(await getDoc())))
sock.emit("ydoc:leave", { room: `doc:${DOC}` })
sock.close()
let stored
for (let i = 0; i < 8; i++) { await sleep(1000); stored = await getDoc(); console.log("t+" + (i + 1) + "s", JSON.stringify(texts(stored))) }
ok(JSON.stringify(texts(stored)) === JSON.stringify(["ALPHA (app)", "bravo web2", "bravo app2", "charlie (web)", "delta (app)"]), `stored: ${JSON.stringify(texts(stored))}`)
// 5. the app edits again with no room open (room reopened from the kept state, closed after).
r = await edit(stored, { type: "doc", content: [...stored.content, P("echo (app, room closed)")] })
await sleep(500)
ok(r.status === 200 && JSON.stringify(texts(await getDoc())).includes("echo (app, room closed)"), `edit with no live room: ${r.status}`)
const del = await fetch(`${BASE}/api/docs/${DOC}`, { method: "DELETE", headers: H })
ok(del.ok, `test page deleted: ${del.status}`)
