export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { accrueLatePenalties } from "@/lib/attendance-absence"

// Per-minute cron: live-accrue the late penalty (-1 XP/min, capped 120) for members past
// their shift start who haven't checked in yet — so XP ticks down in real time without
// waiting for check-in. Auth: CRON_SECRET bearer, or a logged-in attendance admin.
export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    let authorized = false
    if (cronSecret && bearer && bearer === cronSecret) {
      authorized = true
    } else {
      const session = await auth()
      if (session?.user?.id) {
        const ctx = await getAttendanceWorkspaceContext(session.user.id)
        if (ctx.canManageAttendance) authorized = true
      }
    }
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const result = await accrueLatePenalties()
    return NextResponse.json(result)
  } catch (error) {
    console.error("accrue-late error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
