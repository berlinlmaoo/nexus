export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { ROOM_BOOKING_ROOMS } from "@/lib/validations"

// PUBLIC, no-login read for the per-room TV display. Returns ONLY a single known room's ACTIVE bookings
// with minimal fields (time + title) — no creator/description/workspace, so nothing personal leaks.
// Room must be one of the known rooms (else 404, so this can't be used to probe arbitrary data).
export async function GET(req: NextRequest) {
  try {
    const room = req.nextUrl.searchParams.get("room") ?? ""
    if (!(ROOM_BOOKING_ROOMS as readonly string[]).includes(room)) {
      return NextResponse.json({ error: "Unknown room" }, { status: 404 })
    }

    const now = new Date()
    const startParam = req.nextUrl.searchParams.get("rangeStart")
    const endParam = req.nextUrl.searchParams.get("rangeEnd")
    // Default window: start of today → +14 days (covers "now / next" + upcoming agenda).
    const start = startParam ? new Date(startParam) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = endParam ? new Date(endParam) : new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 })
    }

    const bookings = await prisma.roomBooking.findMany({
      where: { room, status: "ACTIVE", startsAt: { lte: end }, endsAt: { gte: start } },
      select: { id: true, room: true, title: true, startsAt: true, endsAt: true },
      orderBy: [{ startsAt: "asc" }],
      take: 300,
    })

    return NextResponse.json({
      room,
      rooms: ROOM_BOOKING_ROOMS,
      serverTime: now.toISOString(),
      bookings,
    })
  } catch (error) {
    console.error("Public room-display GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
