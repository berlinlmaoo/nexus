export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  sendEmail,
  taskAssignedEmail,
  taskDueSoonEmail,
  commentMentionEmail,
  projectInviteEmail,
  statusUpdateEmail,
} from "@/lib/email"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { type, recipientId, data } = await req.json()

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { name: true, email: true },
    })
    if (!recipient)
      return NextResponse.json({ error: "Recipient not found" }, { status: 404 })

    let payload
    switch (type) {
      case "taskAssigned":
        payload = taskAssignedEmail({ recipientName: recipient.name, ...data })
        break
      case "taskDueSoon":
        payload = taskDueSoonEmail({ recipientName: recipient.name, ...data })
        break
      case "commentMention":
        payload = commentMentionEmail({ recipientName: recipient.name, ...data })
        break
      case "projectInvite":
        payload = projectInviteEmail({ recipientName: recipient.name, ...data })
        break
      case "statusUpdate":
        payload = statusUpdateEmail({ recipientName: recipient.name, ...data })
        break
      default:
        return NextResponse.json({ error: "Unknown email type" }, { status: 400 })
    }

    payload.to = recipient.email
    const sent = await sendEmail(payload)
    logAudit({ action: "create", entityType: "email", userId: session.user.id, request: req, metadata: { type, recipientId } })
    return NextResponse.json({ sent })
  } catch (error) {
    console.error("Email API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
