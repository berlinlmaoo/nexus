export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { bi, recipientLang } from "@/lib/notification-text"
import { logAudit } from "@/lib/audit"
import { emitNotification } from "@/lib/socket-emitter"

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const timestamp = new Date()
    const hm = timestamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" })
    const { texts } = bi(["Test notification", `Desktop notification test at ${hm}`], ["Notifikasi tes", `Tes notifikasi desktop jam ${hm}`])
    const lang = await recipientLang(session.user.id)
    const notification = await prisma.notification.create({
      data: {
        userId: session.user.id,
        type: "test_notification",
        ...texts[lang],
        texts,
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
