export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { roomAvailability, roomWorkspaceIds } from "@/lib/room-booking"

const MAX_SLOT_MS = 24 * 60 * 60 * 1000

/**
 * GET /api/room-bookings/availability?startsAt=ISO&endsAt=ISO — every room for one slot (free, or booked by
 * whom until when), plus the nearest free slots (same day, ±2 h) when no room
 * is free. The room picker on GIDEON's book_room card reads it, again whenever a slot chip is picked; the
 * slot is re-checked on Apply anyway. `excludeBookingId` (optional, 16 Oct 2026): the booking a move card is
 * moving, so its own current slot does not show as taken by itself.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const start = new Date(req.nextUrl.searchParams.get("startsAt") ?? "")
    const end = new Date(req.nextUrl.searchParams.get("endsAt") ?? "")
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end.getTime() - start.getTime() > MAX_SLOT_MS) {
      return NextResponse.json({ error: "Invalid time range" }, { status: 400 })
    }
    const workspaceIds = await roomWorkspaceIds(session.user.id)
    if (workspaceIds.length === 0) return NextResponse.json({ rooms: [], freeSlots: [] })
    const excludeId = req.nextUrl.searchParams.get("excludeBookingId")?.trim() || undefined
    return NextResponse.json(await roomAvailability(workspaceIds, start, end, excludeId))
  } catch (error) {
    console.error("Room availability GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
