export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import { isRegisteredRedirectUri, MCP_SCOPES } from "@/lib/mcp-oauth"

// Backing data for the SPA consent page (/oauth/authorize). Same-origin, cookie-authenticated.
// Returns 401 when not logged in (the page then shows an inline login), 400 for a bad client/redirect.
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "login_required" }, { status: 401 })

  const rl = checkRateLimitByKey("oauth_info", session.user.id, { limit: 30, windowSeconds: 60 })
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const sp = request.nextUrl.searchParams
  const clientId = sp.get("client_id")?.trim()
  const redirectUri = sp.get("redirect_uri")?.trim()
  if (!clientId || !redirectUri) return NextResponse.json({ error: "invalid_request", error_description: "client_id and redirect_uri are required." }, { status: 400 })
  if (clientId.length > 64 || redirectUri.length > 2048) return NextResponse.json({ error: "invalid_request", error_description: "Parameter too long." }, { status: 400 })

  const client = await prisma.oAuthClient.findUnique({ where: { id: clientId }, select: { clientName: true, redirectUris: true } })
  if (!client) return NextResponse.json({ error: "invalid_client", error_description: "Unknown client." }, { status: 400 })
  if (!isRegisteredRedirectUri(redirectUri, client.redirectUris)) {
    return NextResponse.json({ error: "invalid_redirect_uri", error_description: "redirect_uri not registered for this client." }, { status: 400 })
  }

  let redirectHost = ""
  try {
    redirectHost = new URL(redirectUri).host
  } catch {
    redirectHost = ""
  }

  return NextResponse.json({
    clientName: client.clientName,
    redirectHost, // shown on consent so a user can spot a phishing client whose code goes to a foreign host
    user: { name: session.user.name ?? null, email: session.user.email ?? null },
    scopes: MCP_SCOPES,
  })
}
