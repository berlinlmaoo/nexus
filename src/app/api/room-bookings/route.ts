export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { createRoomBookingSchema, validateBody } from "@/lib/validations"
import { bookingInclude, createRoomBooking, roomWorkspaceIds, ROOMS_NOT_AVAILABLE } from "@/lib/room-booking"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const rangeStart = searchParams.get("rangeStart")
    const rangeEnd = searchParams.get("rangeEnd")
    const room = searchParams.get("room")

    if (!rangeStart || !rangeEnd) {
      return NextResponse.json({ error: "rangeStart and rangeEnd are required" }, { status: 400 })
    }

    const start = new Date(rangeStart)
    const end = new Date(rangeEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 })
    }

    // Rooms belong to the company workspace only (B-6): anyone else sees no bookings at all.
    // `roomsAvailable` is additive; released apps ignore it and just see an empty list.
    const workspaceIds = await roomWorkspaceIds(session.user.id)
    if (workspaceIds.length === 0) {
      return NextResponse.json({ bookings: [], roomsAvailable: false })
    }

    const bookings = await prisma.roomBooking.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        status: "ACTIVE",
        ...(room ? { room } : {}),
        // overlaps [start, end]
        startsAt: { lte: end },
        endsAt: { gte: start },
      },
      include: bookingInclude,
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    })

    return NextResponse.json({ bookings, roomsAvailable: true })
  } catch (error) {
    console.error("Room bookings GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const validation = validateBody(createRoomBookingSchema, body)
    if (!validation.success) {
      return validation.error
    }

    const { room, title, startsAt, endsAt, description } = validation.data
    // Always the company workspace (B-6): it used to be the person's first workspace, which for somebody with a
    // personal workspace too could be the personal one (and skip the company's double-booking guard).
    const workspaceIds = await roomWorkspaceIds(session.user.id)
    const workspaceId = workspaceIds[0]
    if (!workspaceId) {
      return NextResponse.json({ ...ROOMS_NOT_AVAILABLE }, { status: 403 })
    }

    // The same path as GIDEON's book_room (lib/room-booking.ts): range and past checks, the conflict guard
    // over the user's workspaces, the database's exclusion constraint for two requests at once, and the
    // "Room booked" notification.
    const result = await createRoomBooking({
      userId: session.user.id,
      workspaceId,
      scopeWorkspaceIds: workspaceIds,
      room,
      title,
      description,
      start: new Date(startsAt),
      end: new Date(endsAt),
    })
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json({ booking: result.booking }, { status: 201 })
  } catch (error) {
    console.error("Room bookings POST error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}
