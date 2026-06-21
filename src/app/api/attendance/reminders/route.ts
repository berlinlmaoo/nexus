export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { sendAttendanceReminders } from "@/lib/attendance-reminders"

// Cron secret OR a logged-in attendance admin (canManageAttendance). Mirrors /accrue-late & /deduct-absences.
async function authorize(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  if (cronSecret && bearer && bearer === cronSecret) return true
  const session = await auth()
  if (session?.user?.id) {
    const ctx = await getAttendanceWorkspaceContext(session.user.id)
    if (ctx.canManageAttendance) return true
  }
  return false
}

// GET → READ-ONLY dry-run preview: who is in scope for reminders today + the exact times they'd be
// pinged. Sends nothing. Open it in the browser while logged in as BoD, or curl with the cron secret.
export async function GET(req: NextRequest) {
  try {
    if (!(await authorize(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const result = await sendAttendanceReminders(new Date(), { dryRun: true })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[attendance-reminders] preview failed", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST → the LIVE send (driven by the per-minute cron). Sends real WhatsApp messages.
export async function POST(req: NextRequest) {
  try {
    if (!(await authorize(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const result = await sendAttendanceReminders(new Date())
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[attendance-reminders] failed", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
