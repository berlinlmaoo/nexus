export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const sessions = await prisma.userSession.findMany({
      where: {
        userId: session.user.id,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastActiveAt: true,
        expiresAt: true,
      },
      orderBy: { lastActiveAt: "desc" },
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error("Sessions GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Revoke all other sessions
    const result = await prisma.userSession.updateMany({
      where: {
        userId: session.user.id,
        revoked: false,
      },
      data: { revoked: true },
    })

    logAudit({
      action: "delete",
      entityType: "user_sessions",
      userId: session.user.id,
      request: req,
      metadata: { revokedCount: result.count, action: "revoke_all" },
    })

    return NextResponse.json({ revoked: result.count })
  } catch (error) {
    console.error("Sessions DELETE all error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
