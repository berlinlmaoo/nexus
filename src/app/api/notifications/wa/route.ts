import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { phone, message } = await req.json()

    if (!phone || !message) {
      return NextResponse.json(
        { error: "phone and message are required" },
        { status: 400 }
      )
    }

    const webhookUrl = process.env.WA_WEBHOOK_URL
    if (!webhookUrl) {
      console.log("[WA] Webhook not configured. Message:", { phone, message })
      return NextResponse.json({ sent: false, reason: "WA_WEBHOOK_URL not configured" })
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, message }),
    })

    if (!res.ok) {
      return NextResponse.json(
        { sent: false, reason: "Webhook returned " + res.status },
        { status: 502 }
      )
    }

    logAudit({ action: "create", entityType: "waMessage", userId: session.user.id, request: req, metadata: { phone } })
    return NextResponse.json({ sent: true })
  } catch (error) {
    console.error("WA API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
