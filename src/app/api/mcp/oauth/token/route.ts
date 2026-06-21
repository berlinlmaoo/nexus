export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkRateLimitByKey, rateLimitResponse, trustedClientIp } from "@/lib/rate-limit"
import {
  hashToken,
  verifyPkceS256,
  generateAccessToken,
  generateRefreshToken,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  MCP_SCOPES,
} from "@/lib/mcp-oauth"

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "*" }
const ACCESS_TTL_S = Math.floor(ACCESS_TOKEN_TTL_MS / 1000)
const MAX_ID = 64
const MAX_TOKEN = 256

function oauthError(error: string, description?: string, status = 400) {
  return NextResponse.json({ error, ...(description ? { error_description: description } : {}) }, { status, headers: CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// Accept both application/x-www-form-urlencoded (OAuth default) and JSON.
async function readParams(request: NextRequest): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") || ""
  if (ct.includes("application/json")) {
    try {
      const j = (await request.json()) as Record<string, unknown>
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(j)) if (typeof v === "string") out[k] = v
      return out
    } catch {
      return {}
    }
  }
  const form = await request.formData()
  const out: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v
  return out
}

function issueTokens() {
  const access = generateAccessToken()
  const refresh = generateRefreshToken()
  return {
    access,
    refresh,
    accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  }
}

function tokenResponse(accessToken: string, refreshToken: string) {
  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refreshToken,
      scope: MCP_SCOPES.join(" "),
    },
    { status: 200, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } }
  )
}

// Best-effort housekeeping so expired/used auth codes don't accumulate.
function reapAuthCodes() {
  prisma.oAuthAuthCode.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] } }).catch(() => {})
}

export async function POST(request: NextRequest) {
  const rl = checkRateLimitByKey("oauth_token", trustedClientIp(request), { limit: 60, windowSeconds: 60 })
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const p = await readParams(request)
  const grantType = (p.grant_type || "").trim()
  const clientId = (p.client_id || "").trim()

  if (!clientId || clientId.length > MAX_ID) return oauthError("invalid_client", "client_id required", 401)
  const client = await prisma.oAuthClient.findUnique({ where: { id: clientId }, select: { id: true, clientName: true } })
  if (!client) return oauthError("invalid_client", "Unknown client", 401)

  // ---- authorization_code grant ----
  if (grantType === "authorization_code") {
    const code = (p.code || "").trim()
    const redirectUri = (p.redirect_uri || "").trim()
    const codeVerifier = (p.code_verifier || "").trim()
    if (!code || !redirectUri || !codeVerifier) return oauthError("invalid_request", "code, redirect_uri, code_verifier required")
    if (code.length > MAX_TOKEN || redirectUri.length > 2048 || codeVerifier.length > 256) return oauthError("invalid_request", "Parameter too long")

    const authCode = await prisma.oAuthAuthCode.findUnique({
      where: { codeHash: hashToken(code) },
      select: { id: true, clientId: true, userId: true, redirectUri: true, codeChallenge: true, scopes: true, expiresAt: true, consumedAt: true },
    })
    if (!authCode) return oauthError("invalid_grant", "Unknown or expired code")
    if (authCode.clientId !== client.id) return oauthError("invalid_grant", "Code was issued to a different client")
    if (authCode.redirectUri !== redirectUri) return oauthError("invalid_grant", "redirect_uri mismatch")
    if (authCode.consumedAt) return oauthError("invalid_grant", "Code already used")
    if (authCode.expiresAt.getTime() < Date.now()) return oauthError("invalid_grant", "Code expired")
    if (!verifyPkceS256(codeVerifier, authCode.codeChallenge)) return oauthError("invalid_grant", "PKCE verification failed")

    // Atomically consume the code (single-use, race-safe).
    const consumed = await prisma.oAuthAuthCode.updateMany({ where: { id: authCode.id, consumedAt: null }, data: { consumedAt: new Date() } })
    if (consumed.count !== 1) return oauthError("invalid_grant", "Code already used")

    const t = issueTokens()
    await prisma.apiToken.create({
      data: {
        name: `${client.clientName} (OAuth)`,
        tokenHash: t.access.tokenHash,
        scopes: authCode.scopes.length ? authCode.scopes : MCP_SCOPES,
        expiresAt: t.accessExpiresAt,
        refreshTokenHash: t.refresh.tokenHash,
        refreshExpiresAt: t.refreshExpiresAt,
        clientId: client.id,
        userId: authCode.userId,
      },
    })
    reapAuthCodes()
    return tokenResponse(t.access.token, t.refresh.token)
  }

  // ---- refresh_token grant (rotating, with reuse detection) ----
  if (grantType === "refresh_token") {
    const refreshToken = (p.refresh_token || "").trim()
    if (!refreshToken || refreshToken.length > MAX_TOKEN) return oauthError("invalid_request", "refresh_token required")
    const presentedHash = hashToken(refreshToken)

    const existing = await prisma.apiToken.findUnique({
      where: { refreshTokenHash: presentedHash },
      select: { id: true, clientId: true, userId: true, scopes: true, refreshExpiresAt: true },
    })

    if (!existing) {
      // A previously-rotated (stale) refresh token replayed = theft. Revoke the whole connection.
      const reused = await prisma.apiToken.findUnique({ where: { prevRefreshTokenHash: presentedHash }, select: { id: true, userId: true } })
      if (reused) {
        await prisma.apiToken.delete({ where: { id: reused.id } }).catch(() => {})
        try {
          await logAudit({ action: "delete", entityType: "oauth_token", entityId: reused.id, entityName: `${client.clientName} (OAuth)`, userId: reused.userId, metadata: { via: "mcp-oauth", reason: "refresh_token_reuse" } })
        } catch {
          /* best-effort */
        }
        return oauthError("invalid_grant", "Refresh token reuse detected; connection revoked")
      }
      return oauthError("invalid_grant", "Unknown refresh token")
    }
    if (!existing.clientId || existing.clientId !== client.id) return oauthError("invalid_grant", "Refresh token was issued to a different client")
    if (existing.refreshExpiresAt && existing.refreshExpiresAt.getTime() < Date.now()) return oauthError("invalid_grant", "Refresh token expired")

    const t = issueTokens()
    await prisma.apiToken.update({
      where: { id: existing.id },
      data: {
        tokenHash: t.access.tokenHash,
        expiresAt: t.accessExpiresAt,
        refreshTokenHash: t.refresh.tokenHash,
        prevRefreshTokenHash: presentedHash, // remember consumed token to detect replay
        refreshExpiresAt: t.refreshExpiresAt,
        lastUsedAt: new Date(),
      },
    })
    return tokenResponse(t.access.token, t.refresh.token)
  }

  return oauthError("unsupported_grant_type", `grant_type "${grantType}" not supported`)
}
