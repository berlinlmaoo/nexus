export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import { generateAuthCode, isRegisteredRedirectUri, buildRedirect, AUTH_CODE_TTL_MS, MCP_SCOPES, MCP_RESOURCE } from "@/lib/mcp-oauth"

// The consent decision. Same-origin, cookie-authenticated. On approve, mints a single-use PKCE auth
// code and returns the redirect back to the client; on deny, returns an access_denied redirect.
// IMPORTANT: we only ever redirect to a redirect_uri that is registered for the client (no open redirect).
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "login_required" }, { status: 401 })

  const rl = checkRateLimitByKey("oauth_decision", session.user.id, { limit: 20, windowSeconds: 60 })
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid_request", error_description: "Body must be JSON." }, { status: 400 })
  }

  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "")
  const clientId = str("client_id")
  const redirectUri = str("redirect_uri")
  const codeChallenge = str("code_challenge")
  const codeChallengeMethod = str("code_challenge_method") || "S256"
  const state = str("state")
  const resource = str("resource") || null
  const approve = body.approve === true

  if (!clientId || !redirectUri) return NextResponse.json({ error: "invalid_request", error_description: "client_id and redirect_uri are required." }, { status: 400 })
  if (clientId.length > 64 || redirectUri.length > 2048) return NextResponse.json({ error: "invalid_request", error_description: "Parameter too long." }, { status: 400 })
  // Single-resource server: reject a resource indicator that isn't us (RFC 8707 audience binding).
  if (resource && resource !== MCP_RESOURCE) return NextResponse.json({ error: "invalid_target", error_description: "Unknown resource." }, { status: 400 })

  const client = await prisma.oAuthClient.findUnique({ where: { id: clientId }, select: { id: true, clientName: true, redirectUris: true } })
  if (!client) return NextResponse.json({ error: "invalid_client", error_description: "Unknown client." }, { status: 400 })
  // Reject before any redirect if the redirect_uri isn't registered — prevents open-redirect abuse.
  if (!isRegisteredRedirectUri(redirectUri, client.redirectUris)) {
    return NextResponse.json({ error: "invalid_redirect_uri", error_description: "redirect_uri not registered for this client." }, { status: 400 })
  }

  // User declined consent.
  if (!approve) {
    return NextResponse.json({ redirectTo: buildRedirect(redirectUri, { error: "access_denied", ...(state ? { state } : {}) }) })
  }

  // PKCE is mandatory; only S256 is accepted.
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return NextResponse.json({ redirectTo: buildRedirect(redirectUri, { error: "invalid_request", error_description: "PKCE S256 code_challenge required", ...(state ? { state } : {}) }) })
  }

  const { code, codeHash } = generateAuthCode()
  await prisma.oAuthAuthCode.create({
    data: {
      codeHash,
      clientId: client.id,
      userId: session.user.id,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: "S256",
      scopes: MCP_SCOPES,
      resource,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  })

  try {
    await logAudit({ action: "create", entityType: "oauth_authorization", entityId: client.id, entityName: client.clientName, userId: session.user.id, request, metadata: { via: "mcp-oauth", scopes: MCP_SCOPES } })
  } catch {
    /* best-effort */
  }

  // Best-effort housekeeping: drop expired/used codes so they don't accumulate.
  prisma.oAuthAuthCode.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] } }).catch(() => {})

  return NextResponse.json({ redirectTo: buildRedirect(redirectUri, { code, ...(state ? { state } : {}) }) })
}
