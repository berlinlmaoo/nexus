export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { readSessionToken, revokeSessionKeys, sessionKeyOf } from "@/lib/user-sessions"

/** DELETE /api/user/sessions/:id — sign that one session out; its device is refused on its next request. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { sessionId } = await params

    // Only the caller's own sessions.
    const userSession = await prisma.userSession.findFirst({
      where: { id: sessionId, userId: session.user.id },
      select: { id: true, token: true },
    })

    if (!userSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    await revokeSessionKeys(session.user.id, [userSession.token])
    const current = sessionKeyOf(await readSessionToken(req)) === userSession.token

    logAudit({
      action: "delete",
      entityType: "user_session",
      entityId: sessionId,
      userId: session.user.id,
      request: req,
      metadata: { current },
    })

    return NextResponse.json({ success: true, current })
  } catch (error) {
    console.error("Session DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
