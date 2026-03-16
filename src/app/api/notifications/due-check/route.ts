import { NextResponse } from "next/server"
import { checkDueSoonTasks } from "@/lib/notification-service"

// Can be called by cron or manually to check for due-soon tasks
export async function POST() {
  try {
    await checkDueSoonTasks()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Due-check error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
