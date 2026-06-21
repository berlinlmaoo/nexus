import crypto from "crypto"
import { hashToken } from "@/lib/mcp-token-auth"

// Canonical public origin Claude connects to. Everything OAuth (issuer, endpoints, resource) is
// anchored here so discovery metadata is stable regardless of which internal host serves the request.
export const MCP_ISSUER = (process.env.MCP_OAUTH_ISSUER || "https://nexus.patsgroup.id").replace(/\/+$/, "")
export const MCP_RESOURCE = `${MCP_ISSUER}/api/mcp`

export const OAUTH_AUTHORIZE_URL = `${MCP_ISSUER}/oauth/authorize` // SPA consent page
export const OAUTH_TOKEN_URL = `${MCP_ISSUER}/api/mcp/oauth/token`
export const OAUTH_REGISTER_URL = `${MCP_ISSUER}/api/mcp/oauth/register`

export const MCP_SCOPES = ["tasks:read", "tasks:write"]

// Lifetimes.
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const CODE_PREFIX = "nxc_"
const ACCESS_PREFIX = "nxo_"
const REFRESH_PREFIX = "nxr_"

function randomToken(prefix: string): string {
  return prefix + crypto.randomBytes(32).toString("hex")
}

/** Mint an authorization code (plaintext returned to redirect; only hash stored). */
export function generateAuthCode(): { code: string; codeHash: string } {
  const code = randomToken(CODE_PREFIX)
  return { code, codeHash: hashToken(code) }
}

/** Mint an OAuth access token ("nxo_…"). Stored in ApiToken.tokenHash. */
export function generateAccessToken(): { token: string; tokenHash: string } {
  const token = randomToken(ACCESS_PREFIX)
  return { token, tokenHash: hashToken(token) }
}

/** Mint an OAuth refresh token ("nxr_…"). Stored in ApiToken.refreshTokenHash. */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomToken(REFRESH_PREFIX)
  return { token, tokenHash: hashToken(token) }
}

export { hashToken }

/**
 * Verify a PKCE code_verifier against a stored S256 code_challenge.
 * challenge == base64url(sha256(verifier)). Constant-time compare. Only S256 is supported.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false
  // RFC 7636: verifier is 43–128 chars of unreserved set.
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false
  const computed = crypto.createHash("sha256").update(codeVerifier).digest("base64url")
  const a = Buffer.from(computed)
  const b = Buffer.from(codeChallenge)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** A redirect_uri is acceptable only if it exactly matches one the client registered. */
export function isRegisteredRedirectUri(redirectUri: string, registered: string[]): boolean {
  return typeof redirectUri === "string" && registered.includes(redirectUri)
}

/**
 * Validate a redirect URI is a sane absolute https URL (or a localhost http URL, which OAuth allows
 * for native/desktop clients). Used at registration time to reject junk before we ever store it.
 */
export function isValidRedirectUri(uri: string): boolean {
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return false
  }
  if (u.hash) return false
  if (u.protocol === "https:") return true
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1")) return true
  return false
}

/** Build a redirect back to the client, appending query params (preserving any existing ones). */
export function buildRedirect(redirectUri: string, params: Record<string, string>): string {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}
