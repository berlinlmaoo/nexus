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
const CODEX = process.env.CODEX_BIN || "codex"
const HERMES = process.env.HERMES_BIN || "hermes"

// The three GIDEON tiers, and the only place that knows which model each one is. NEXUS sends a tier
// name; nothing upstream of here needs to learn a model id, so retuning a tier is a change to this
// table alone.
//
// --provider is NOT optional. Hermes resolves a model to a provider through its catalogue, and the
// catalogue does not list gpt-6-astra under openai-codex — so without naming the provider Hermes
// refuses in two seconds with "No LLM provider configured", which reads like the model is gone.
// Verified against v0.21.0; updating Hermes did not change it.
// Each tier names its own provider now, because one of them does not live at OpenAI. Keeping the
// provider beside the model means adding a fourth engine is a line in this table rather than a
// branch further down.
const TIERS = {
  astra: { model: "gpt-6-astra", provider: "openai-codex", timeoutMs: 140000 },
  luna: { model: "gpt-5.6-luna", provider: "openai-codex", timeoutMs: 140000 },
  terra: { model: "gpt-5.6-terra", provider: "openai-codex", timeoutMs: 140000 },
  // Local: Qwen3.5-27B IQ2_M on the RTX 5070 in this building. Measured at 142s for a question the
  // hosted tiers answer in 42, so it gets its own ceiling — 140s would have timed it out at the
  // exact moment it was about to succeed.
  experimental: { model: "gideon-experimental", provider: "ollama-local", timeoutMs: 420000 },
}
const DEFAULT_TIER = "luna"

// ── Instance knobs (12 Oct 2026). All optional: unset, the shim behaves exactly as before. ──────────
// HERMES_PROFILE_HOME: run every Hermes child with this HERMES_HOME (a profile dir). The DEV instance
//   points it at ~/.hermes/profiles/gideon-dev, whose .env aims the NEXUS plugin at the dev server and
//   whose plugin copy has no attendance tools. Prod leaves it unset (default profile).
// GIDEON_RUNNER: path to gideon-stream-runner.py. Enables POST /chat-stream (NDJSON, token by token).
// GIDEON_PYTHON: the python that can import Hermes (the Hermes venv).
// GIDEON_TOOLSETS: the toolsets the streaming runner may use. Explicit on purpose; default nexus,vision.
// GIDEON_DOCS=0: refuse document attachments (the dev instance has no file toolset to read them with).
const PROFILE_HOME = process.env.HERMES_PROFILE_HOME || ""
const RUNNER = process.env.GIDEON_RUNNER || ""
const PYTHON = process.env.GIDEON_PYTHON || path.join(os.homedir(), ".hermes", "hermes-agent", ".venv", "bin", "python")
const STREAM_TOOLSETS = process.env.GIDEON_TOOLSETS || "nexus,vision"
const DOCS_ENABLED = process.env.GIDEON_DOCS !== "0"
const SHIM_NAME = process.env.GIDEON_SHIM_NAME || "hermes-chat"
// A NEXUS GideonRun id (cuid). Forwarded to the plugin as NEXUS_GIDEON_RUN_ID, which sends it back to
// /api/gideon/tools as x-gideon-run: that is how NEXUS ties each tool call (steps, sources, cards,
// approval) to the conversation that caused it. Anything that does not look like an id is dropped.
function cleanRunId(v) {
  const s = String(v || "")
  return /^[a-z0-9]{10,40}$/i.test(s) ? s : ""
}
function childEnv(actorEmail, runId) {
  const env = { ...process.env }
  if (PROFILE_HOME) env.HERMES_HOME = PROFILE_HOME
  if (actorEmail) env.NEXUS_GIDEON_ACTOR_EMAIL = actorEmail
  if (runId) env.NEXUS_GIDEON_RUN_ID = runId
  else delete env.NEXUS_GIDEON_RUN_ID
  // The shim's own secret has no business inside the agent's environment.
  delete env.ORACLE_LLM_SECRET
  return env
}
// Neutral, empty workdir so Codex has nothing to act on even if it tried.
const WORKDIR = path.join(os.homedir(), ".hermes", "oracle-workdir")
try { fs.mkdirSync(WORKDIR, { recursive: true }) } catch {}

// Extensions Hermes's read_file actually turns into text. This is not a guess: read_extract.py
// handles .ipynb/.docx/.xlsx from the stdlib and the rest through the bundled firecrawl-anydoc,
// and plain text needs no converter at all. Verified on this VM with a real hermes run — a PDF and
// a .txt written here were both read back correctly.
//
// The extension is the ONLY thing taken from the client's filename. The name itself never becomes
// a path: a document called "../../.ssh/authorized_keys" would otherwise be exactly that.
const DOC_EXTENSIONS = new Set([
  "pdf",
  "txt", "md", "csv", "tsv", "json", "log", "yml", "yaml", "xml", "html",
  "docx", "doc", "xlsx", "xls", "pptx", "ppt",
  "odt", "ods", "odp", "rtf", "epub", "ipynb",
])
// A document is base64 in a JSON body, so it arrives ~4/3 its real size. 10 MB of file is the
// ceiling NEXUS enforces; this is that plus slack, so a request that got past NEXUS is never cut
// off here by a rounding difference. Hermes itself would read at most ~100K characters of it
// anyway, so a larger cap would buy nothing but memory.
const MAX_DOC_B64 = 14_000_000

function pickDocExt(name, type) {
  const fromName = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  if (fromName && DOC_EXTENSIONS.has(fromName[1])) return fromName[1]
  const bare = String(type || "").toLowerCase().replace(/^\./, "").split("/").pop()
  if (DOC_EXTENSIONS.has(bare)) return bare
  return null
}

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

// The original filename is worth telling the model — "invoice-agustus.pdf" is context the random
// on-disk name throws away — but it is client-supplied text going into a prompt, so it is stripped
// of anything that could read as a new instruction or a second path.
function safeDocLabel(name) {
  const clean = String(name || "").replace(/[\r\n]+/g, " ").replace(/[^\w. ()\-]/g, "").trim().slice(0, 80)
  return clean || null
}

function buildAttachedPrompt(prompt, imagePath, doc) {
  const lines = []
  if (imagePath) lines.push(`Ada gambar terlampir di ${imagePath}. Lihat gambar itu lebih dulu, lalu jawab.`)
  if (doc && doc.path) {
    const label = safeDocLabel(doc.name)
    lines.push(
      `Ada dokumen terlampir di ${doc.path}${label ? ` (nama aslinya "${label}")` : ""}. ` +
        "Baca isi dokumen itu lebih dulu pakai read_file — PDF dan Office otomatis diekstrak jadi teks — lalu jawab.",
    )
  }
  if (!lines.length) return prompt
  // One attachment keeps the wording it has always had; both present get one line each.
  return `${lines.join("\n")}\n\n${prompt}`
}

// Gideon chatbox → run the full Hermes agent one-shot (gpt-5.5 + live NEXUS tools). Slower (~30s).
// actorEmail (the logged-in NEXUS user) is injected as NEXUS_GIDEON_ACTOR_EMAIL on THIS spawn only, so
// the NEXUS plugin sends it as x-gideon-actor and the tools act as that user (role-scoped).
function runHermes(prompt, actorEmail, tier, imagePath, doc, runId) {
  return new Promise((resolve) => {
    const env = childEnv(actorEmail, runId)
    // An unknown tier falls back rather than failing: a client sending a name this shim has not
    // learned yet should get an answer from the default, not an error.
    const chosen = TIERS[tier] || TIERS[DEFAULT_TIER]
    const { model, provider, timeoutMs } = chosen
    // Hermes has no attachment flag. Its vision toolset reads from disk, so an image reaches the
    // model as a path named in the prompt — verified: it read every field off a screenshot.
    // A document travels the same way, but to a different tool: read_file, not the vision toolset.
    // Telling it to LOOK at a PDF sends it to vision, which cannot open one; telling it to READ
    // the file gets the anydoc text extraction. So the two attachments get different wording, and
    // the image-only sentence is left exactly as it was.
    const full = buildAttachedPrompt(prompt, imagePath, doc)
    const child = spawn(HERMES, ["-z", full, "-m", model, "--provider", provider], { cwd: WORKDIR, env })
    let out = "", err = ""
    try { child.stdin.end() } catch {}
    child.stdout.on("data", (d) => { out += d.toString() })
    child.stderr.on("data", (d) => { err += d.toString() })
    const timer = setTimeout(() => { try { child.kill("SIGKILL") } catch {} }, timeoutMs)
    child.on("close", () => {
      clearTimeout(timer)
      const reply = out.trim()
      if (!reply) console.error(`[${SHIM_NAME}] empty reply; err:`, err.slice(-200).replace(/\n/g, " "))
      resolve(reply)
    })
    child.on("error", (e) => { clearTimeout(timer); console.error("[hermes-chat] spawn error", e.message); resolve("") })
  })
}

// The streaming twin of runHermes: gideon-stream-runner.py prints NDJSON lines (delta / reset / tool /
// final / error) and each line is passed straight through to NEXUS as it arrives. The prompt goes in on
// stdin, never argv. A run that times out is killed and reported as an error line, so the caller always
// sees an end to the stream.
function runHermesStream(prompt, actorEmail, tier, imagePath, res, runId) {
  return new Promise((resolve) => {
    const env = childEnv(actorEmail, runId)
    const chosen = TIERS[tier] || TIERS[DEFAULT_TIER]
    const { model, provider, timeoutMs } = chosen
    const full = buildAttachedPrompt(prompt, imagePath, null)
    const child = spawn(PYTHON, [RUNNER, "--model", model, "--provider", provider, "--toolsets", STREAM_TOOLSETS], { cwd: WORKDIR, env })
    let err = "", sawFinal = false, outChars = 0, pending = ""
    child.stdout.on("data", (d) => {
      pending += d.toString()
      let nl
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trim()
        pending = pending.slice(nl + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line)
          if (ev.t === "final") { sawFinal = true; outChars = String(ev.c || "").length }
        } catch { continue }
        try { res.write(line + "\n") } catch {}
      }
    })
    child.stderr.on("data", (d) => { err += d.toString(); if (err.length > 4000) err = err.slice(-2000) })
    try { child.stdin.end(full) } catch {}
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL") } catch {}
      try { res.write(JSON.stringify({ t: "error", c: "timeout" }) + "\n") } catch {}
    }, timeoutMs)
    // NEXUS hung up (user closed the panel): stop paying for an answer nobody will read.
    res.on("close", () => { if (child.exitCode === null) { try { child.kill("SIGKILL") } catch {} } })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (!sawFinal) console.error(`[${SHIM_NAME}] stream ended without final (code ${code}); err:`, err.slice(-200).replace(/\n/g, " "))
      resolve({ ok: sawFinal, outChars })
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      console.error(`[${SHIM_NAME}] stream spawn error`, e.message)
      try { res.write(JSON.stringify({ t: "error", c: "spawn failed" }) + "\n") } catch {}
      resolve({ ok: false, outChars: 0 })
    })
  })
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") { res.writeHead(200); return res.end("ok") }
  if (req.method !== "POST") { res.writeHead(404); return res.end("not found") }
  if (!SECRET || req.headers["x-oracle-secret"] !== SECRET) { res.writeHead(401); return res.end("unauthorized") }
  const isStream = req.url.startsWith("/chat-stream")
  const isChat = req.url.startsWith("/chat") && !isStream
  const isInterpret = req.url.startsWith("/interpret")
  if (!isChat && !isInterpret && !isStream) { res.writeHead(404); return res.end("not found") }
  if (isStream && !RUNNER) { res.writeHead(404); return res.end("streaming not enabled on this shim") }
  let body = ""
  // 8 KB was right for a prompt and wrong the moment an image had to travel with it. NEXUS
  // downscales before sending, so this is a ceiling for the pathological case, not the normal one.
  // Raised from 12 MB when documents joined: an image is downscaled on the way in and a document
  // is not — 10 MB of PDF is ~13.4 MB once base64'd, which the old cap would have severed
  // mid-stream, and a severed body is an unparseable JSON error rather than a readable refusal.
  req.on("data", (c) => { body += c; if (body.length > 24_000_000) req.destroy() })
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
    const tier = (payload.model || "").toString().toLowerCase().slice(0, 20)
    const chosen = TIERS[tier] ? tier : DEFAULT_TIER

    // A document is refused rather than dropped when Hermes could not open it: a silently ignored
    // attachment produces a confident answer about nothing, which reads as GIDEON lying about a
    // file it never saw. Both refusals are decided BEFORE anything is written, so an early return
    // here cannot leave an orphaned attachment in the workdir.
    const runId = cleanRunId(payload.runId)
    const hasDoc = typeof payload.documentBase64 === "string" && payload.documentBase64.length > 32
    if (hasDoc && (!DOCS_ENABLED || isStream)) {
      res.writeHead(415, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ error: "documents_not_supported_here" }))
    }
    const docExt = hasDoc ? pickDocExt(payload.documentName, payload.documentType) : null
    if (hasDoc && !docExt) {
      res.writeHead(415, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ error: "unsupported_document_type", accepted: [...DOC_EXTENSIONS].sort() }))
    }
    if (hasDoc && payload.documentBase64.length > MAX_DOC_B64) {
      res.writeHead(413, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ error: "document_too_large", maxBase64Chars: MAX_DOC_B64 }))
    }

    // The image lands in the workdir under a random name and is removed whatever happens. Left
    // behind, one person's photo would sit on disk where the next person's agent can read it.
    let imagePath = null
    if (typeof payload.imageBase64 === "string" && payload.imageBase64.length > 32) {
      try {
        const ext = payload.imageType === "png" ? "png" : "jpg"
        imagePath = path.join(WORKDIR, `gideon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
        fs.mkdirSync(WORKDIR, { recursive: true })
        fs.writeFileSync(imagePath, Buffer.from(payload.imageBase64, "base64"), { mode: 0o600 })
      } catch (e) {
        console.error("[hermes-chat] gagal menulis gambar:", e.message)
        imagePath = null
      }
    }

    // Same route as the image — bytes to disk under a random name, path named in the prompt,
    // removed in the finally. Only the extension comes from the client's filename; the name itself
    // is never part of the path.
    let doc = null
    if (hasDoc) {
      try {
        const docPath = path.join(WORKDIR, `gideon-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${docExt}`)
        fs.mkdirSync(WORKDIR, { recursive: true })
        fs.writeFileSync(docPath, Buffer.from(payload.documentBase64, "base64"), { mode: 0o600 })
        doc = { path: docPath, name: payload.documentName }
      } catch (e) {
        // Unlike the image, this does not fall through to answering anyway: the question is
        // usually about the document, so a refusal is more use than an answer that ignores it.
        console.error("[hermes-chat] gagal menulis dokumen:", e.message)
        if (imagePath) { try { fs.unlinkSync(imagePath) } catch {} }
        res.writeHead(500, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ error: "document_write_failed" }))
      }
    }

    const started = Date.now()
    if (isStream) {
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" })
      let r = { ok: false, outChars: 0 }
      try {
        r = await runHermesStream(prompt, actorEmail, chosen, imagePath, res, runId)
      } finally {
        if (imagePath) { try { fs.unlinkSync(imagePath) } catch {} }
      }
      console.log(`[${SHIM_NAME}] stream ${chosen}${imagePath ? " +gambar" : ""} in=${prompt.length}c -> ${r.ok ? `out=${r.outChars}c` : "FAILED"} (${Date.now() - started}ms)`)
      return res.end()
    }
    let reply
    try {
      reply = await runHermes(prompt, actorEmail, chosen, imagePath, doc, runId)
    } finally {
      if (imagePath) { try { fs.unlinkSync(imagePath) } catch {} }
      if (doc) { try { fs.unlinkSync(doc.path) } catch {} }
    }
    console.log(`[${SHIM_NAME}] ${chosen}${imagePath ? " +gambar" : ""}${doc ? " +dokumen" : ""} in=${prompt.length}c -> out=${reply.length}c (${Date.now() - started}ms)`)
    res.writeHead(200, { "Content-Type": "application/json" })
    return res.end(JSON.stringify({ reply }))
  })
})

server.listen(PORT, process.env.ORACLE_LLM_HOST || "127.0.0.1", () => console.log(`[${SHIM_NAME}] listening on ${process.env.ORACLE_LLM_HOST || "127.0.0.1"}:${PORT} (profile=${PROFILE_HOME || "default"}, stream=${RUNNER ? "on" : "off"}, docs=${DOCS_ENABLED ? "on" : "off"})`))
