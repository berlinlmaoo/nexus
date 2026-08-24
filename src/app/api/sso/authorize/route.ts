// First-party SSO for the Z Network hiring dashboard (znetworks.id).
//
// The hiring app redirects the browser here with ?redirect=<its callback>&state=<csrf>. Because this
// runs on nexus.patsgroup.id it can read the NEXUS session via auth(). Flow:
//   - not logged in            -> 302 back with ?sso=nologin (hiring prompts to log in / use email).
//   - logged in, no decision   -> render a consent page ("Izinkan / Tolak").
//   - logged in, decision=allow -> 302 back with a short-lived HMAC token (id + name).
//   - logged in, decision=deny  -> 302 back with ?sso=denied.
// Only exact-match allowlisted callbacks are ever redirected to (open-redirect guard).
import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { auth } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SECRET = process.env.NEXUS_SSO_SECRET || ""
const ALLOWED_REDIRECTS = new Set([
  "https://znetworks.id/apply/dashboard/sso-callback",
  "https://careerdashboard.znetworks.id/dashboard/sso-callback",
])
const TOKEN_TTL_MS = 120_000 // 2 minutes — used immediately by the hiring callback.

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))

function mintToken(userId: string, name: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, n: name, aud: "hiring-dashboard", e: Date.now() + TOKEN_TTL_MS })
  ).toString("base64url")
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url")
  return `${payload}.${sig}`
}

function consentPage(name: string, email: string, redirect: string, state: string): string {
  const q = (d: string) => `/api/sso/authorize?redirect=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}&decision=${d}`
  const initial = (name.trim()[0] || "?").toUpperCase()
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Izinkan akses — NEXUS</title>
<style>
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;background:#f4f5f8;color:#232830;display:grid;place-items:center;padding:24px;-webkit-font-smoothing:antialiased}
  .card{width:100%;max-width:404px;background:#fff;border:1px solid #e6e8ec;border-radius:18px;padding:30px 28px;box-shadow:0 14px 44px rgba(23,28,38,.13)}
  .badge{width:44px;height:44px;border-radius:12px;background:linear-gradient(160deg,#7b68ee,#6750cf);display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px;box-shadow:0 8px 20px rgba(123,104,238,.32)}
  h1{font-size:19px;font-weight:750;letter-spacing:-.3px;margin:18px 0 6px}
  .sub{font-size:13.5px;color:#5b636e;line-height:1.55;margin-bottom:20px}
  .who{display:flex;align-items:center;gap:11px;background:#f8f9fb;border:1px solid #e6e8ec;border-radius:12px;padding:11px 13px;margin-bottom:16px}
  .av{width:34px;height:34px;border-radius:50%;background:#7b68ee;color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px;flex:none}
  .who b{font-size:13.5px;font-weight:650;display:block} .who span{font-size:12px;color:#79818e}
  .scope{font-size:12.5px;color:#4b4270;background:#f1eefe;border-radius:10px;padding:11px 13px;margin-bottom:22px;line-height:1.5}
  .row{display:flex;gap:10px}
  .btn{flex:1;text-align:center;text-decoration:none;padding:12px;border-radius:11px;font:700 13.5px inherit;cursor:pointer;border:1px solid #dcdfe5;color:#232830;background:#fff;transition:background .14s}
  .btn:hover{background:#f1f3f6}
  .btn.pri{color:#fff;background:#7b68ee;border-color:transparent;box-shadow:0 4px 12px rgba(123,104,238,.28)} .btn.pri:hover{background:#6750cf}
  .foot{font-size:11px;color:#79818e;text-align:center;margin-top:16px;line-height:1.5}
</style></head>
<body><div class="card">
  <div class="badge">Z</div>
  <h1>Izinkan akses?</h1>
  <div class="sub"><b>Z Network Hiring Dashboard</b> mau masuk pakai akun NEXUS kamu.</div>
  <div class="who"><div class="av">${esc(initial)}</div><div><b>${esc(name)}</b><span>${esc(email)}</span></div></div>
  <div class="scope">Yang diakses: <b>nama kamu</b>, buat nyatet siapa yang buka lamaran. Ga ada akses ke data NEXUS lain.</div>
  <div class="row"><a class="btn" href="${q("deny")}">Tolak</a><a class="btn pri" href="${q("allow")}">Izinkan</a></div>
  <div class="foot">Masuk sebagai akun di atas. Bukan kamu? Logout dari NEXUS dulu.</div>
</div></body></html>`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const redirect = url.searchParams.get("redirect") || ""
  const state = url.searchParams.get("state") || ""
  const decision = url.searchParams.get("decision") || ""

  if (!SECRET) return NextResponse.json({ error: "sso_not_configured" }, { status: 503 })
  if (!ALLOWED_REDIRECTS.has(redirect)) return NextResponse.json({ error: "invalid_redirect" }, { status: 400 })

  const back = new URL(redirect)
  if (state) back.searchParams.set("state", state)

  const session = await auth()
  if (!session?.user?.id) {
    back.searchParams.set("sso", "nologin")
    return NextResponse.redirect(back, 302)
  }

  if (decision === "deny") {
    back.searchParams.set("sso", "denied")
    return NextResponse.redirect(back, 302)
  }
  if (decision === "allow") {
    back.searchParams.set("token", mintToken(String(session.user.id), session.user.name || "NEXUS user"))
    return NextResponse.redirect(back, 302)
  }

  // Logged in, awaiting the user's choice → show the consent screen.
  return new NextResponse(consentPage(session.user.name || "NEXUS user", session.user.email || "", redirect, state), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  })
}
