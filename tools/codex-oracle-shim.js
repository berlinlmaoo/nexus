#!/usr/bin/env node
// NEXUS Oracle — Codex LLM shim (runs on the HOST, not in Docker).
// The NEXUS backend (container) POSTs a natural-language question here; we ask the locally-authed
// Codex CLI (ChatGPT OAuth, gpt-5.5) to classify it into a structured intent JSON, and return that.
// Codex ONLY classifies — it never touches the DB; the backend runs every query itself.
//
// PROD runs this under launchd as `com.nexus.gideon-shim`, from a COPY at
//   ~/Library/Application Support/Nexus/codex-oracle-shim.js
// (macOS TCC blocks launchd agents from reading ~/Documents). If you edit this file, re-copy it:
//   cp tools/codex-oracle-shim.js "$HOME/Library/Application Support/Nexus/"
//   launchctl kickstart -k gui/$(id -u)/com.nexus.gideon-shim
//
// Run detached (local only):  ORACLE_LLM_SECRET=... node tools/codex-oracle-shim.js
// Env:  ORACLE_LLM_SECRET (required, shared with the backend)  ORACLE_LLM_PORT (default 8765)
const http = require("http")
const { spawn } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const PORT = parseInt(process.env.ORACLE_LLM_PORT || "8765", 10)
const SECRET = process.env.ORACLE_LLM_SECRET || ""
const CODEX = process.env.CODEX_BIN || "/Users/jagainmacmini1/.local/bin/codex"
const HERMES = process.env.HERMES_BIN || "/Users/jagainmacmini1/.local/bin/hermes"
// Neutral, empty workdir so Codex has nothing to act on even if it tried.
const WORKDIR = path.join(os.homedir(), ".hermes", "oracle-workdir")
try { fs.mkdirSync(WORKDIR, { recursive: true }) } catch {}

const INTENTS = ["tasks_by_person", "tasks_by_project", "overdue", "due_today", "busiest", "project_summary", "list_projects", "search"]

function buildPrompt(q) {
  return [
    'Kamu parser intent untuk aplikasi manajemen proyek "NEXUS". Diberi sebuah pertanyaan (Bahasa Indonesia),',
    "keluarkan HANYA satu objek JSON satu baris. TANPA penjelasan, TANPA markdown, TANPA code fence.",
    'Skema: {"intent": salah satu dari ' + JSON.stringify(INTENTS) + ', "person": string opsional (nama orang), "project": string opsional (nama project), "query": string opsional (kata kunci)}',
    "Aturan singkat:",
    "- task/kerjaan <nama orang> -> tasks_by_person, person=<nama>",
    "- task/project <nama project> -> tasks_by_project, project=<nama>",
    "- overdue/telat/lewat deadline -> overdue (boleh sertakan person/project kalau disebut)",
    "- due/deadline hari ini -> due_today",
    "- siapa paling sibuk / workload -> busiest",
    "- ringkasan/progress project <X> -> project_summary, project=<X>",
    "- ada project apa aja / daftar project -> list_projects",
    "- selain itu -> search, query=<kata kunci penting>",
    'Pertanyaan: "' + q.replace(/"/g, "'") + '"',
    "JSON:",
  ].join("\n")
}

function extractIntent(stdout) {
  // Pull the last JSON object that contains an "intent" key out of Codex's noisy output.
  const matches = stdout.match(/\{[^{}]*"intent"[^{}]*\}/g)
  if (!matches) return null
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(matches[i])
      if (obj && typeof obj.intent === "string") {
        const clean = { intent: INTENTS.includes(obj.intent) ? obj.intent : "search" }
        if (typeof obj.person === "string" && obj.person.trim()) clean.person = obj.person.trim()
        if (typeof obj.project === "string" && obj.project.trim()) clean.project = obj.project.trim()
        if (typeof obj.query === "string" && obj.query.trim()) clean.query = obj.query.trim()
        return clean
      }
    } catch {}
  }
  return null
}

function runCodex(query) {
  return new Promise((resolve) => {
    const child = spawn(CODEX, ["exec", "--skip-git-repo-check", buildPrompt(query)], {
      cwd: WORKDIR,
      env: process.env,
    })
    let out = "", err = ""
    try { child.stdin.end() } catch {}
    child.stdout.on("data", (d) => { out += d.toString() })
    child.stderr.on("data", (d) => { err += d.toString() })
    const timer = setTimeout(() => { try { child.kill("SIGKILL") } catch {} }, 28000)
    child.on("close", () => {
      clearTimeout(timer)
      const intent = extractIntent(out)
      if (intent) return resolve(intent)
      // Fallback: never fail the request — let the backend do a plain search.
      console.error("[oracle-shim] no intent parsed; out tail:", out.slice(-200).replace(/\n/g, " "), "err:", err.slice(-120))
      resolve({ intent: "search", query })
    })
    child.on("error", (e) => { clearTimeout(timer); console.error("[oracle-shim] spawn error", e.message); resolve({ intent: "search", query }) })
  })
}

// Gideon chatbox → run the full Hermes agent one-shot (gpt-5.5 + live NEXUS tools). Slower (~30s).
// actorEmail (the logged-in NEXUS user) is injected as NEXUS_GIDEON_ACTOR_EMAIL on THIS spawn only, so
// the NEXUS plugin sends it as x-gideon-actor and the tools act as that user (role-scoped).
function runHermes(prompt, actorEmail) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    if (actorEmail) env.NEXUS_GIDEON_ACTOR_EMAIL = actorEmail
    const child = spawn(HERMES, ["-z", prompt], { cwd: WORKDIR, env })
    let out = "", err = ""
    try { child.stdin.end() } catch {}
    child.stdout.on("data", (d) => { out += d.toString() })
    child.stderr.on("data", (d) => { err += d.toString() })
    const timer = setTimeout(() => { try { child.kill("SIGKILL") } catch {} }, 140000)
    child.on("close", () => {
      clearTimeout(timer)
      const reply = out.trim()
      if (!reply) console.error("[hermes-chat] empty reply; err:", err.slice(-200).replace(/\n/g, " "))
      resolve(reply)
    })
    child.on("error", (e) => { clearTimeout(timer); console.error("[hermes-chat] spawn error", e.message); resolve("") })
  })
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") { res.writeHead(200); return res.end("ok") }
  if (req.method !== "POST") { res.writeHead(404); return res.end("not found") }
  if (!SECRET || req.headers["x-oracle-secret"] !== SECRET) { res.writeHead(401); return res.end("unauthorized") }
  const isChat = req.url.startsWith("/chat")
  const isInterpret = req.url.startsWith("/interpret")
  if (!isChat && !isInterpret) { res.writeHead(404); return res.end("not found") }
  let body = ""
  req.on("data", (c) => { body += c; if (body.length > 8000) req.destroy() })
  req.on("end", async () => {
    let payload = {}
    try { payload = JSON.parse(body || "{}") } catch {}
    if (isInterpret) {
      const query = (payload.query || "").toString().slice(0, 400)
      if (!query.trim()) { res.writeHead(400); return res.end(JSON.stringify({ error: "empty" })) }
      const started = Date.now()
      const intent = await runCodex(query)
      console.log(`[oracle-shim] "${query.slice(0, 60)}" -> ${intent.intent} (${Date.now() - started}ms)`)
      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(JSON.stringify(intent))
    }
    // /chat → Hermes agent
    const prompt = (payload.prompt || "").toString().slice(0, 6000)
    if (!prompt.trim()) { res.writeHead(400); return res.end(JSON.stringify({ error: "empty" })) }
    const actorEmail = (payload.actorEmail || "").toString().slice(0, 200)
    const started = Date.now()
    const reply = await runHermes(prompt, actorEmail)
    console.log(`[hermes-chat] in=${prompt.length}c -> out=${reply.length}c (${Date.now() - started}ms)`)
    res.writeHead(200, { "Content-Type": "application/json" })
    return res.end(JSON.stringify({ reply }))
  })
})

server.listen(PORT, "127.0.0.1", () => console.log(`[oracle-shim] listening on 127.0.0.1:${PORT} (codex=${CODEX})`))
