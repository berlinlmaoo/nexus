export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { checkDueSoonTasks } from "@/lib/notification-service"

// Can be called by cron or manually to check for due-soon tasks
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
    if (bearer !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    await checkDueSoonTasks()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Due-check error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
