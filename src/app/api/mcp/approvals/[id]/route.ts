export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { publicBaseUrl } from "@/lib/public-url"
import { McpAttendanceError, approvalView, decideApproval } from "@/lib/mcp-attendance"

/**
 * The web approval page behind an MCP attendance correction (/approve/mcp/<secret>, lib/mcp-attendance.ts).
 * A normal NEXUS web session only: the cookie session of the person who owns the MCP connection. A request carrying
 * an Authorization header (an MCP or app bearer token) is refused outright, so the assistant that asked can never
 * approve its own request. POST also needs the page's CSRF token and a same-origin Origin.
 *
 *   GET  → { requestId, app, status, expiresAt, kind, reason, before, after, flags, csrf }
 *   POST { decision: "APPROVE" | "REJECT" } + header X-Nexus-Csrf → { status, result? }
 * Errors: 401 LOGIN_REQUIRED, 403 BEARER_REFUSED | WRONG_USER | CSRF | ORIGIN, 404 NOT_FOUND,
 *         409 ALREADY_DECIDED | EXPIRED | CHANGED, 422 other refusals (the reason in `error`).
 */
const STATUS: Record<string, number> = {
  NOT_FOUND: 404, WRONG_USER: 403, CSRF: 403, EXPIRED: 409, ALREADY_DECIDED: 409, CHANGED: 409, DISCONNECTED: 409,
  FORBIDDEN: 403, OUTSIDE_APPROVAL_CHAIN: 403, SELF: 403, NOT_A_MEMBER: 403,
}
const noStore = { "Cache-Control": "no-store" }
const err = (code: string, error: string, status: number) => NextResponse.json({ error, code }, { status, headers: noStore })

async function sessionOnly(req: NextRequest) {
  if (req.headers.get("authorization")) return { refused: err("BEARER_REFUSED", "Approve this in NEXUS on the web, signed in. Tokens cannot approve.", 403) }
  const session = await auth()
  if (!session?.user?.id) return { refused: err("LOGIN_REQUIRED", "Sign in to NEXUS first.", 401) }
  return { user: { id: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null } }
}

function fromError(e: unknown) {
  if (e instanceof McpAttendanceError) return err(e.code, e.message, STATUS[e.code] ?? 422)
  console.error("mcp approval error:", e)
  return err("ERROR", "Internal server error", 500)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await sessionOnly(req)
  if (s.refused) return s.refused
  try {
    const { id } = await params
    return NextResponse.json({ ...(await approvalView(id, s.user.id)), viewer: { name: s.user.name, email: s.user.email } }, { headers: noStore })
  } catch (e) {
    return fromError(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await sessionOnly(req)
  if (s.refused) return s.refused
  // Same-origin only (the cookie is SameSite=Lax; this closes the rest): the Origin must be this NEXUS.
  const origin = req.headers.get("origin")
  let expected = ""
  try { expected = new URL(publicBaseUrl()).origin } catch { expected = "" }
  if (!origin || !expected || origin !== expected || (req.headers.get("sec-fetch-site") ?? "same-origin") !== "same-origin") {
    return err("ORIGIN", "Open the approval link in NEXUS itself.", 403)
  }
  const body = (await req.json().catch(() => null)) as { decision?: unknown } | null
  const decision = body?.decision === "APPROVE" || body?.decision === "REJECT" ? body.decision : null
  if (!decision) return err("BAD_REQUEST", "decision must be APPROVE or REJECT.", 400)
  try {
    const { id } = await params
    const out = await decideApproval({ secret: id, session: s.user, decision, csrf: req.headers.get("x-nexus-csrf") ?? "", request: req })
    return NextResponse.json(out, { headers: noStore })
  } catch (e) {
    return fromError(e)
  }
}
