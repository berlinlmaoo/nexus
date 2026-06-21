export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAttendanceWorkspaceContext, parseDateOnlyToUtc } from "@/lib/attendance"
import { processAbsenceDeductions } from "@/lib/attendance-absence"

// Triggered by the nightly cron (Authorization: Bearer <CRON_SECRET>) or by an
// attendance admin (logged-in session with canManageAttendance) via the admin button.
export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    let authorized = false
    let actor = "cron"

    if (cronSecret && bearer && bearer === cronSecret) {
      authorized = true
    } else {
      const session = await auth()
      if (session?.user?.id) {
        const ctx = await getAttendanceWorkspaceContext(session.user.id)
        if (ctx.canManageAttendance) {
          authorized = true
          actor = session.user.id
        }
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let from: Date | undefined
    let to: Date | undefined
    try {
      const body = (await req.json()) as { from?: string; to?: string } | null
      if (body?.from) from = parseDateOnlyToUtc(body.from)
      if (body?.to) to = parseDateOnlyToUtc(body.to)
    } catch {
      // no body → default rolling window
    }

    const result = await processAbsenceDeductions({ from, to })
    return NextResponse.json({ ...result, actor })
  } catch (error) {
    console.error("deduct-absences error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}
