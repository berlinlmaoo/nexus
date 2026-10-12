export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { readSessionToken, revokeOtherSessions, sessionKeyOf } from "@/lib/user-sessions"

/**
 * GET /api/user/sessions — the caller's live sessions (lib/user-sessions.ts), the caller's own first and
 * flagged `current`. Shape: { sessions: [{ id, ipAddress, userAgent, client, createdAt, lastActiveAt,
 * expiresAt, current }] } — the fields before `client` are the ones the web has always read.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const currentKey = sessionKeyOf(await readSessionToken(req))

    const rows = await prisma.userSession.findMany({
      where: {
        userId: session.user.id,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        token: true,
        ipAddress: true,
        userAgent: true,
        client: true,
        createdAt: true,
        lastActiveAt: true,
        expiresAt: true,
      },
      orderBy: { lastActiveAt: "desc" },
      take: 200,
    })

    const sessions = rows
      .map(({ token, ...row }) => ({ ...row, current: currentKey !== null && token === currentKey }))
      .sort((a, b) => Number(b.current) - Number(a.current))

    return NextResponse.json({ sessions }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Sessions GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** DELETE /api/user/sessions — sign out every OTHER session; the caller's own stays signed in. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const currentKey = sessionKeyOf(await readSessionToken(req))

    const revoked = await revokeOtherSessions(session.user.id, currentKey)

    logAudit({
      action: "delete",
      entityType: "user_sessions",
      userId: session.user.id,
      request: req,
      metadata: { revokedCount: revoked, action: "revoke_others" },
    })

    return NextResponse.json({ revoked })
  } catch (error) {
    console.error("Sessions DELETE all error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
