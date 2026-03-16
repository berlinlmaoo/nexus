import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { sessionId } = await params

    // Verify the session belongs to this user
    const userSession = await prisma.userSession.findFirst({
      where: { id: sessionId, userId: session.user.id },
    })

    if (!userSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    await prisma.userSession.update({
      where: { id: sessionId },
      data: { revoked: true },
    })

    logAudit({
      action: "delete",
      entityType: "user_session",
      entityId: sessionId,
      userId: session.user.id,
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Session DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
