export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

/**
 * The app reports whether it can track location for this check-in: { recordId, state: "on" | "denied" }.
 * "denied" = the person refused "Always" location permission, so the board can show "location off"
 * instead of an empty trail that looks like someone who never left.
 *
 * Only the owner's own record, and only while it is open. A web check-in keeps "web" (it is not
 * tracked at all). Points arriving later set "on" by themselves (lib/attendance-location.ts).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    type StatusBody = { recordId?: unknown; state?: unknown }
    let body: StatusBody | null = null
    try {
      body = (await request.json()) as StatusBody
    } catch {
      body = null
    }
    const recordId = typeof body?.recordId === "string" ? body.recordId.trim() : ""
    const state = body?.state
    if (!recordId || (state !== "on" && state !== "denied")) {
      return NextResponse.json({ error: "Body must be { recordId, state: \"on\" | \"denied\" }.", code: "INVALID_BODY" }, { status: 400 })
    }

    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, userId: true, status: true, checkOutAt: true, locationTrackingState: true },
    })
    if (!record || record.userId !== session.user.id) {
      return NextResponse.json({ error: "Attendance record not found." }, { status: 404 })
    }
    if (record.status !== "CHECKED_IN" || record.checkOutAt !== null || record.locationTrackingState === "web") {
      return NextResponse.json({ ok: true, locationTrackingState: record.locationTrackingState ?? null, changed: false })
    }
    if (record.locationTrackingState !== state) {
      await prisma.attendanceRecord.updateMany({
        where: { id: record.id, status: "CHECKED_IN", checkOutAt: null },
        data: { locationTrackingState: state },
      })
    }
    return NextResponse.json({ ok: true, locationTrackingState: state, changed: record.locationTrackingState !== state })
  } catch (error) {
    console.error("Error storing location tracking state:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
