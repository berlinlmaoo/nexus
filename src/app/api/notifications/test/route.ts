import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { emitNotification } from "@/lib/socket-emitter"

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const timestamp = new Date()
    const notification = await prisma.notification.create({
      data: {
        userId: session.user.id,
        type: "test_notification",
        title: "Test Notification",
        message: `Desktop notification test at ${timestamp.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        link: "/inbox",
      },
    })

    emitNotification(session.user.id, JSON.parse(JSON.stringify(notification)))

    logAudit({
      action: "create",
      entityType: "notification",
      entityId: notification.id,
      userId: session.user.id,
      request,
      metadata: { type: "test_notification" },
    })

    return NextResponse.json({ notification })
  } catch (error) {
    console.error("Test notification error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
