import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { channel, message, blocks } = await req.json()

    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      )
    }

    const webhookUrl = process.env.SLACK_WEBHOOK_URL
    if (!webhookUrl) {
      console.log("[SLACK] Webhook not configured. Message:", { channel, message })
      return NextResponse.json({ sent: false, reason: "SLACK_WEBHOOK_URL not configured" })
    }

    const payload: Record<string, unknown> = { text: message }
    if (channel) payload.channel = channel
    if (blocks) payload.blocks = blocks

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      return NextResponse.json(
        { sent: false, reason: "Webhook returned " + res.status },
        { status: 502 }
      )
    }

    logAudit({ action: "create", entityType: "slackMessage", userId: session.user.id, request: req, metadata: { channel } })
    return NextResponse.json({ sent: true })
  } catch (error) {
    console.error("Slack API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
