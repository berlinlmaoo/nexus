import crypto from "crypto"
import prisma from "@/lib/prisma"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"

const TOKEN_PREFIX = "nxs_"
// Accepted bearer-token prefixes: nxs_ = personal access token (Tuning Room), nxo_ = OAuth access token.
const ACCEPTED_PREFIXES = ["nxs_", "nxo_"]

/** SHA-256 hex of a token. High-entropy random tokens don't need bcrypt, and sha256 is
 *  deterministic so we can look it up by hash. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/** Mint a new plaintext token + its hash. The plaintext is shown ONCE; only the hash is stored. */
export function generateApiToken(): { token: string; tokenHash: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("hex")
  return { token, tokenHash: hashToken(token) }
}

/**
 * verifyToken for mcp-handler's withMcpAuth. Validates the bearer token, returns an AuthInfo
 * carrying the resolved userId in `extra` (or undefined → 401). Updates lastUsedAt best-effort.
 */
export async function verifyMcpToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const token = (bearerToken ?? "").trim()
  if (!ACCEPTED_PREFIXES.some((p) => token.startsWith(p))) return undefined

  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, scopes: true, expiresAt: true },
  })
  if (!apiToken) return undefined
  if (apiToken.expiresAt && apiToken.expiresAt.getTime() < Date.now()) return undefined

  // best-effort; don't block the request on this
  prisma.apiToken.update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } }).catch(() => {})

  return {
    token,
    clientId: "nexus-mcp",
    scopes: apiToken.scopes ?? [],
    extra: { userId: apiToken.userId, tokenId: apiToken.id },
  }
}

/** Pull the authenticated userId out of an MCP tool handler's `extra` (set by withMcpAuth). */
export function mcpUserId(extra: { authInfo?: AuthInfo }): string {
  const userId = (extra.authInfo?.extra as { userId?: string } | undefined)?.userId
  if (!userId) throw new Error("Unauthorized")
  return userId
}
