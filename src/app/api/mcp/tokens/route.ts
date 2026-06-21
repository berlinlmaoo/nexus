export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { generateApiToken } from "@/lib/mcp-token-auth"

const MAX_TOKENS_PER_USER = 10
const DEFAULT_EXPIRES_DAYS = 90

// Self-service MCP token management. A logged-in user mints a personal access token for the
// NEXUS MCP server. The token acts AS that user (RBAC applies), and the MCP server only exposes
// task tools — so a token can never do more than its owner can do with tasks.

const createSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

/** GET — list the caller's tokens (metadata only, never the plaintext). */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Personal access tokens only (clientId null) — OAuth-issued tokens are managed via the Claude app.
  const tokens = await prisma.apiToken.findMany({
    where: { userId: session.user.id, clientId: null },
    select: { id: true, name: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({ tokens })
}

/** POST — mint a new token. The plaintext is returned ONCE and never stored. */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Throttle minting: a few per minute per user is plenty for a human flow.
  const rl = checkRateLimit(request, session.user.id, { limit: 5, windowSeconds: 60 })
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const parsed = createSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  // Cap standing credentials per user so tokens can't pile up unbounded.
  const existingCount = await prisma.apiToken.count({ where: { userId: session.user.id, clientId: null } })
  if (existingCount >= MAX_TOKENS_PER_USER) {
    return NextResponse.json(
      { error: `Token limit reached (max ${MAX_TOKENS_PER_USER}). Revoke an existing token first.` },
      { status: 429 }
    )
  }

  const { token, tokenHash } = generateApiToken()
  // Tokens always expire. Default to 90 days; caller may opt into 1–365 (schema-bounded), never forever.
  const days = parsed.data.expiresInDays ?? DEFAULT_EXPIRES_DAYS
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

  const created = await prisma.apiToken.create({
    data: {
      name: parsed.data.name?.trim() || "Claude MCP",
      tokenHash,
      scopes: ["tasks:read", "tasks:write"],
      expiresAt,
      userId: session.user.id,
    },
    select: { id: true, name: true, scopes: true, expiresAt: true, createdAt: true },
  })

  try {
    await logAudit({ action: "create", entityType: "api_token", entityId: created.id, entityName: created.name, userId: session.user.id, request, metadata: { via: "mcp", scopes: created.scopes } })
  } catch {
    /* best-effort */
  }

  // `token` is shown exactly once — the client must copy it now.
  return NextResponse.json({ token, ...created }, { status: 201 })
}

/** DELETE — revoke a token the caller owns. Pass ?id=<tokenId>. */
export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = new URL(request.url).searchParams.get("id")?.trim()
  if (!id) return NextResponse.json({ error: "Missing token id" }, { status: 400 })

  // scope the delete to the caller so nobody can revoke someone else's token
  const result = await prisma.apiToken.deleteMany({ where: { id, userId: session.user.id } })
  if (result.count === 0) return NextResponse.json({ error: "Token not found" }, { status: 404 })

  try {
    await logAudit({ action: "delete", entityType: "api_token", entityId: id, entityName: "MCP token", userId: session.user.id, request, metadata: { via: "mcp" } })
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ revoked: true })
}
