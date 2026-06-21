export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { checkRateLimitByKey, rateLimitResponse, trustedClientIp } from "@/lib/rate-limit"
import { isValidRedirectUri, MCP_SCOPES } from "@/lib/mcp-oauth"

// OAuth 2.0 Dynamic Client Registration (RFC 7591). Open registration (no auth) is expected for MCP —
// a registered client can't obtain any token without a NEXUS user logging in AND consenting, so this
// only creates an identity. Rate-limited to curb junk registrations.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "*" }

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest) {
  const rl = checkRateLimitByKey("oauth_register", trustedClientIp(request), { limit: 20, windowSeconds: 60 })
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Body must be JSON." }, { status: 400, headers: CORS })
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : []
  if (redirectUris.length === 0) {
    return NextResponse.json({ error: "invalid_redirect_uri", error_description: "redirect_uris is required." }, { status: 400, headers: CORS })
  }
  if (redirectUris.length > 10 || !redirectUris.every(isValidRedirectUri)) {
    return NextResponse.json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be ≤10 absolute https (or localhost http) URLs." }, { status: 400, headers: CORS })
  }

  const clientName = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 120) : "MCP Client"
  // We only support public clients (PKCE), so the auth method is always "none" regardless of request.
  const grantTypes = ["authorization_code", "refresh_token"]
  const responseTypes = ["code"]

  const client = await prisma.oAuthClient.create({
    data: {
      clientName,
      redirectUris,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod: "none",
      scopes: MCP_SCOPES,
    },
    select: { id: true, clientName: true, redirectUris: true, grantTypes: true, responseTypes: true, tokenEndpointAuthMethod: true, createdAt: true },
  })

  // RFC 7591 client information response. No client_secret (public client).
  return NextResponse.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      scope: MCP_SCOPES.join(" "),
    },
    { status: 201, headers: CORS }
  )
}
