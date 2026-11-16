import crypto from "crypto"
import { hashToken } from "@/lib/mcp-token-auth"

// Canonical public origin MCP clients connect to. Everything OAuth (issuer, endpoints, resource) is
// anchored here so discovery metadata is stable regardless of which internal host serves the request.
// MCP_OAUTH_ISSUER when set (dev sets its tailnet URL), else the server's public URL (NEXUS_PUBLIC_URL, set on
// prod and the VPS), else the production domain. Until 17 Nov 2026 the fallback was the retired
// nexus.patsgroup.id, which nginx 302s: MCP clients do not follow a redirected POST, so every connector broke.
export function resolveMcpIssuer(env: Record<string, string | undefined> = process.env): string {
  const raw = env.MCP_OAUTH_ISSUER?.trim() || env.NEXUS_PUBLIC_URL?.trim() || "https://nexus.znetworks.id"
  return raw.replace(/\/+$/, "")
}
export const MCP_ISSUER = resolveMcpIssuer()
export const MCP_RESOURCE = `${MCP_ISSUER}/api/mcp`

export const OAUTH_AUTHORIZE_URL = `${MCP_ISSUER}/oauth/authorize` // SPA consent page
export const OAUTH_TOKEN_URL = `${MCP_ISSUER}/api/mcp/oauth/token`
export const OAUTH_REGISTER_URL = `${MCP_ISSUER}/api/mcp/oauth/register`

/** What a connection gets when it asks for nothing in particular: tasks, as before. */
export const MCP_SCOPES = ["tasks:read", "tasks:write"]
/**
 * Attendance (owner, 17 Nov 2026 — Berlin's assistant Silk). Never granted by default: only a client that asks for
 * them (OAuth `scope`) and a person who sees them on the consent page, or a personal token minted with them ticked.
 * They give nothing beyond the person's own attendance rights (lib/mcp-attendance.ts).
 */
export const MCP_ATTENDANCE_SCOPES = ["attendance:read", "attendance:write"]
export const MCP_ALL_SCOPES = [...MCP_SCOPES, ...MCP_ATTENDANCE_SCOPES]

/**
 * The scopes to grant for a requested OAuth `scope` string (space separated). Unknown names are dropped; nothing
 * known (or no `scope` at all) = the default task scopes. A write scope brings its read scope along.
 */
export function grantedScopes(requested: string | null | undefined): string[] {
  const asked = new Set((requested ?? "").split(/\s+/).map((x) => x.trim()).filter((x) => MCP_ALL_SCOPES.includes(x)))
  if (asked.size === 0) return [...MCP_SCOPES]
  if (asked.has("tasks:write")) asked.add("tasks:read")
  if (asked.has("attendance:write")) asked.add("attendance:read")
  return MCP_ALL_SCOPES.filter((x) => asked.has(x))
}

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
 * The same check for a redirect_uri read from a GET query (the consent page's …/authorize/info). Next.js rewrites the
 * first loopback host in a request URL to "localhost" before the route sees it (next/dist/server/web/next-url.js,
 * REGEX_LOCALHOST_HOSTNAME), and in a URL like ?redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Fcallback that first
 * host is the one inside the query: a client registered with a 127.0.0.1 callback (Hermes, mcp-remote) arrived as
 * "http://localhost:8765/callback" and was refused. So a registered URI also matches in that rewritten form. Only
 * the read-only consent info uses this; the decision and the token exchange read the body and compare exactly.
 */
export function matchesRegisteredRedirectUriFromQuery(redirectUri: string, registered: string[]): boolean {
  if (isRegisteredRedirectUri(redirectUri, registered)) return true
  const asNextSeesIt = (u: string) => u.replace(/^(https?:\/\/)(127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i, "$1localhost")
  return registered.some((r) => asNextSeesIt(r) === redirectUri)
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
