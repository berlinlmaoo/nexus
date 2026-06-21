export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPES } from "@/lib/mcp-oauth"

// OAuth 2.0 Protected Resource Metadata (RFC 9728). Served publicly at
// https://nexus.patsgroup.id/.well-known/oauth-protected-resource (nginx maps it here).
// Tells the MCP client which authorization server protects this resource.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" }

export function GET() {
  return NextResponse.json(
    {
      resource: MCP_RESOURCE,
      authorization_servers: [MCP_ISSUER],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ["header"],
    },
    { headers: CORS }
  )
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
