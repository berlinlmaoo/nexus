export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { MCP_ISSUER, MCP_SCOPES, OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL, OAUTH_REGISTER_URL } from "@/lib/mcp-oauth"

// OAuth 2.0 Authorization Server Metadata (RFC 8414). Served publicly at
// https://nexus.patsgroup.id/.well-known/oauth-authorization-server (nginx maps it here).
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" }

export function GET() {
  return NextResponse.json(
    {
      issuer: MCP_ISSUER,
      authorization_endpoint: OAUTH_AUTHORIZE_URL,
      token_endpoint: OAUTH_TOKEN_URL,
      registration_endpoint: OAUTH_REGISTER_URL,
      scopes_supported: MCP_SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: CORS }
  )
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
