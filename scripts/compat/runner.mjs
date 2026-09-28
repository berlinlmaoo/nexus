// Replays the fixtures against the candidate app on the isolated compat network and prints a table.
//
//   docker run --rm --network <net> -v <dir>:/compat:ro -v <out>:/out \
//     -e COMPAT_BASE=http://app:3000 -e COMPAT_MIN_VERSION=0.1.4 --entrypoint node <image> /compat/runner.mjs
//
// Exit 0 = no FAIL. Exit 1 = at least one FAIL (a released client would break). WARN / PENDING-GATE /
// SKIP never fail the run on their own.
import { readFileSync, writeFileSync } from "node:fs"
import { PROFILES, buildFixtures, isNative } from "./fixtures.mjs"

const BASE = process.env.COMPAT_BASE || "http://app:3000"
const MIN = process.env.COMPAT_MIN_VERSION || "0.1.4"
// The Android floor the candidate was started with (NEXUS_ANDROID_MIN_VERSION in run.sh).
const ANDROID_MIN = process.env.COMPAT_ANDROID_MIN_VERSION || "0.0.0"
const OUT = process.env.COMPAT_OUT || "/out"
// Host the requests claim to be for. Mirrors what nginx sets in production (Host + X-Forwarded-Host
// + X-Forwarded-Proto https) without naming a real domain.
const PUBLIC_HOST = "nexus.compat.invalid"
const world = JSON.parse(readFileSync(`${OUT}/world.json`, "utf8"))
const only = (process.env.COMPAT_PROFILES_RUN || "").split(",").filter(Boolean)

// ---------- media ----------
// A real baseline JPEG (1×1) padded with a COM segment to ~24 KB so it looks like a phone upload in
// size; the server never decodes it, it only checks presence, size and type/extension.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
)
function paddedJpeg(bytes) {
  const pad = Buffer.alloc(bytes, 0x20)
  const len = pad.length + 2
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, (len >> 8) & 0xff, len & 0xff]), pad])
  return Buffer.concat([TINY_JPEG.subarray(0, 2), com, TINY_JPEG.subarray(2)])
}
const media = {
  jpeg: paddedJpeg(24000),
  pdf: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
}

// ---------- version gate model ----------
// Mirrors the owner's policy (24 Sep 2026): minimum floor 0.1.4; legacy apps (no header) are known by
// UA build and, below the minimum, get 426 on attendance WRITES only; header apps below the minimum
// get 426 on every /api/* except /api/app/version-policy and /api/health; web is never blocked.
function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}
function gateBlocks(profile, method, path) {
  if (profile.style === "android") {
    // Own floor; every Android build sends the header, so it is the header rule: all /api/* except
    // the two exempt paths.
    if (cmpVersion(profile.version, ANDROID_MIN) >= 0) return false
    const p = path.split("?")[0]
    if (p.startsWith("/api/app/version-policy") || p.startsWith("/api/health") || p.startsWith("/api/app/android/")) return false
    return p.startsWith("/api/")
  }
  if (profile.style !== "ios") return false
  // A header-less build below 8 is never blocked: the Mac app reused low build numbers until 0.1.6,
  // so the server cannot tell a 0.1.5 Mac from a 0.1.0 iPhone (client-version.ts, 28 Sep 2026).
  if (profile.legacy && profile.build < 8) return false
  if (cmpVersion(profile.version, MIN) >= 0) return false
  const p = path.split("?")[0]
  if (p.startsWith("/api/app/version-policy") || p.startsWith("/api/health")) return false
  if (profile.header) return p.startsWith("/api/")
  return method !== "GET" && p.startsWith("/api/attendance")
}

// ---------- HTTP ----------
function baseHeaders(profile) {
  const h = {
    accept: "application/json",
    "x-forwarded-proto": "https",
    "x-forwarded-host": PUBLIC_HOST,
    "x-forwarded-for": "10.77.0.10",
    "x-real-ip": "10.77.0.10",
  }
  if (profile.style === "ios") {
    h["user-agent"] = `NEXUS/${profile.build} CFNetwork/3826.500.131 Darwin/24.5.0`
    h["accept-language"] = "id-ID,id;q=0.9"
  } else if (profile.style === "android") {
    // API.md: anything that does not start with NEXUS/<digits>; this is the recommended form.
    h["user-agent"] = `NEXUS-Android/${profile.version} (${profile.build}; Android 34)`
    h["accept-language"] = "id-ID,id;q=0.9"
  } else {
    h["user-agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
  }
  if (profile.header) h["x-nexus-client"] = profile.header
  return h
}

// iOS builds its multipart bodies by hand (APIClient.multipartBody / createAttendanceRequest):
// text parts carry no Content-Type, file parts carry exactly the type the app writes.
function iosMultipart(fields, files) {
  const boundary = `Boundary-${crypto.randomUUID().toUpperCase()}`
  const chunks = []
  for (const [k, v] of fields) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`))
    chunks.push(f.data)
    chunks.push(Buffer.from("\r\n"))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}
// OkHttp MultipartBody (FORM): `createFormData(name, value)` parts carry no Content-Type; every part has
// its own Content-Length; files carry the type the app gives them.
function androidMultipart(fields, files) {
  const boundary = crypto.randomUUID()
  const chunks = []
  for (const [k, v] of fields) {
    const value = Buffer.from(String(v))
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\nContent-Length: ${value.length}\r\n\r\n`), value, Buffer.from("\r\n"))
  }
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\nContent-Length: ${f.data.length}\r\n\r\n`))
    chunks.push(f.data)
    chunks.push(Buffer.from("\r\n"))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}
function webFormData(fields, files) {
  const fd = new FormData()
  for (const [k, v] of fields) fd.set(k, v)
  for (const f of files) fd.set(f.field, new File([f.data], f.filename, { type: f.type }))
  return fd
}

async function send(profile, session, { method, path, json, multipart, clientHeader, headers: extraHeaders }) {
  const headers = baseHeaders(profile)
  // A fixture may speak as another build of the same client (the Android gate probes).
  if (clientHeader) headers["x-nexus-client"] = clientHeader
  // …and add request headers of its own (Range / If-Range for the APK download).
  for (const [k, v] of Object.entries(extraHeaders ?? {})) headers[k.toLowerCase()] = v
  if (session?.cookie) headers.cookie = session.cookie
  let body
  if (json !== undefined) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(json)
  } else if (multipart) {
    if (profile.style === "ios" || profile.style === "android") {
      const m = profile.style === "ios" ? iosMultipart(multipart.fields, multipart.files) : androidMultipart(multipart.fields, multipart.files)
      headers["content-type"] = m.contentType
      body = m.body
    } else {
      body = webFormData(multipart.fields, multipart.files)
    }
  }
  if (profile.style === "web" && method !== "GET") {
    headers.origin = `https://${PUBLIC_HOST}`
    headers["sec-fetch-site"] = "same-origin"
  }
  const t0 = Date.now()
  let res
  try {
    res = await fetch(BASE + path, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(30000) })
  } catch (e) {
    return { status: 0, json: null, text: String(e?.cause?.code || e?.message || e), ms: Date.now() - t0, headers: null }
  }
  // Bytes first: the APK fixtures count exactly what came back; JSON bodies decode as before.
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString("utf8")
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = undefined }
  return { status: res.status, json: parsed, text, bytes: buf, ms: Date.now() - t0, headers: res.headers }
}

async function login(profile, user) {
  if (isNative(profile)) {
    const r = await send(profile, null, { method: "POST", path: "/api/auth/app-login", json: { email: user.email, password: world.password } })
    const session = r.json?.token && r.json?.cookieName ? { cookie: `${r.json.cookieName}=${r.json.token}` } : null
    return { r, session }
  }
  const r = await send(profile, null, {
    method: "POST", path: "/api/auth/direct-login", json: { email: user.email, password: world.password, callbackUrl: "/dashboard" },
  })
  const cookies = (r.headers?.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .filter((c) => /authjs\.session-token=/.test(c) && !/=$/.test(c))
  return { r, session: cookies.length ? { cookie: cookies.join("; ") } : null }
}

// ---------- evaluation ----------
function statusMatches(want, got) {
  if (want === "2xx") return got >= 200 && got < 300
  if (want === "4xx") return got >= 400 && got < 500 && got !== 426
  return got === want
}
function short(r) {
  const j = r.json
  const msg = j && typeof j === "object" && !Array.isArray(j) ? (j.code ? `${j.code}: ` : "") + (j.error ?? "") : ""
  return String(msg || (r.json === undefined ? r.text.slice(0, 60).replace(/\s+/g, " ") : "")).slice(0, 90)
}

async function probeGate() {
  const r = await send({ style: "ios", build: 12, header: null }, null, { method: "GET", path: "/api/app/version-policy" })
  return { present: r.status !== 404 && r.status !== 0, status: r.status, body: r.json ?? r.text.slice(0, 200) }
}

const rows = []
const t0 = Date.now()
const gate = await probeGate()
console.log(`version gate: /api/app/version-policy -> ${gate.status} (${gate.present ? "PRESENT" : "absent: gate fixtures reported as PENDING-GATE"}); expected minimum ${MIN}, Android ${ANDROID_MIN}`)
if (gate.present) console.log(`  policy body: ${JSON.stringify(gate.body).slice(0, 300)}`)

for (const profile of PROFILES) {
  if (only.length && !only.includes(profile.id)) continue
  const ctx = {
    flags: {},
    sessions: {},
    users: { a: world.staff[profile.id].a, b: world.staff[profile.id].b, manager: world.manager, bod: world.bod },
  }
  for (const step of buildFixtures(profile, world, media)) {
    const row = { profile: profile.id, id: step.id, title: step.title, kind: step.kind }
    const skip = step.needs?.(ctx)
    const reqSpec = step.login
      ? { method: "POST", path: isNative(profile) ? "/api/auth/app-login" : "/api/auth/direct-login" }
      : step.request(ctx)
    const blocked = gateBlocks(profile, reqSpec.method, reqSpec.path)
    const expected = blocked ? { status: 426 } : step.expect
    row.expected = String(expected.status) + (expected.code ? ` ${expected.code}` : "")

    if (skip && !blocked) {
      Object.assign(row, { result: "SKIP", got: "-", note: skip })
      rows.push(row)
      continue
    }

    let r
    if (step.login) {
      const out = await login(profile, ctx.users[step.as])
      r = out.r
      if (out.session) ctx.sessions[step.as] = out.session
    } else {
      r = await send(profile, ctx.sessions[step.as], reqSpec)
    }
    row.got = String(r.status)
    row.ms = r.ms

    let problem = null
    if (!statusMatches(expected.status, r.status)) problem = `status ${r.status}${short(r) ? ` — ${short(r)}` : ""}`
    else if (expected.code && r.json?.code !== expected.code) problem = `code ${r.json?.code ?? "none"} ≠ ${expected.code}`
    else if (!blocked && !expected.raw && r.json === undefined && r.status >= 200 && r.status < 300) problem = "2xx but body is not JSON (iOS decode would fail)"
    else if (!blocked && expected.check) problem = expected.check(r.json, ctx, r)
    if (step.login && !blocked && r.status === 200 && !ctx.sessions[step.as]) problem = problem ?? "login 200 but no session token/cookie"

    // With the gate absent, a gate-affected step still ran for real: record its ids so the steps after
    // it exercise the same flow they would without a gate.
    const pendingGate = blocked && !gate.present
    if (r.status >= 200 && r.status < 300 && step.after && (!problem || pendingGate)) step.after(r.json, ctx)

    if (pendingGate) {
      row.result = "PENDING-GATE"
      row.note = `gate not in image; today: ${r.status}${short(r) ? ` ${short(r)}` : ""}`
    } else if (!problem) {
      row.result = "PASS"
      row.note = blocked ? `426 as designed (below min ${MIN})` : (r.status >= 400 ? short(r) : "")
    } else if (r.status >= 500 || r.status === 0) {
      row.result = "FAIL"
      row.note = problem
    } else if (step.kind === "policy" && !blocked) {
      row.result = "WARN"
      row.note = `policy changed? ${problem}`
    } else {
      row.result = "FAIL"
      row.note = problem
    }
    rows.push(row)
  }
}

// ---------- report ----------
const cols = [
  ["result", 12], ["profile", 10], ["id", 20], ["title", 52], ["expected", 20], ["got", 4], ["note", 0],
]
const line = (r) => cols.map(([k, w]) => (w ? String(r[k] ?? "").slice(0, w).padEnd(w) : String(r[k] ?? ""))).join(" ")
console.log("")
console.log(line({ result: "RESULT", profile: "PROFILE", id: "FIXTURE", title: "WHAT", expected: "EXPECTED", got: "GOT", note: "NOTE" }))
console.log("-".repeat(150))
let prev = null
for (const r of rows) {
  if (prev && prev !== r.profile) console.log("")
  prev = r.profile
  console.log(line(r))
}
const count = (x) => rows.filter((r) => r.result === x).length
const summary = { min: MIN, gate: gate.present ? "present" : "absent", pass: count("PASS"), fail: count("FAIL"), warn: count("WARN"), pendingGate: count("PENDING-GATE"), skip: count("SKIP"), seconds: +((Date.now() - t0) / 1000).toFixed(1) }
console.log("-".repeat(150))
console.log(`min=${MIN}  PASS ${summary.pass}  FAIL ${summary.fail}  WARN ${summary.warn}  PENDING-GATE ${summary.pendingGate}  SKIP ${summary.skip}  (${summary.seconds}s)`)
if (summary.fail) {
  console.log("\nREGRESSIONS — a client that is on people's phones would break:")
  for (const r of rows.filter((x) => x.result === "FAIL")) console.log(`  ✗ ${r.profile} ${r.id}: expected ${r.expected}, got ${r.got} — ${r.note}`)
}
try { writeFileSync(`${OUT}/results-min-${MIN}.json`, JSON.stringify({ summary, gate, rows }, null, 2)) } catch {}
process.exit(summary.fail ? 1 : 0)
