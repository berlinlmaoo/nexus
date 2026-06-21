export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getUserWorkspaceIds } from "@/lib/workspace-scope"
import { createRoomBookingSchema, validateBody } from "@/lib/validations"

const bookingInclude = {
  createdBy: { select: { id: true, name: true, email: true, avatar: true } },
} as const

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

    const workspaceIds = await getUserWorkspaceIds(session.user.id)
    if (workspaceIds.length === 0) {
      return NextResponse.json({ bookings: [] })
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

    return NextResponse.json({ bookings })
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

    const body = await req.json()
    const validation = validateBody(createRoomBookingSchema, body)
    if (!validation.success) {
      return validation.error
    }

    const { room, title, startsAt, endsAt, description } = validation.data
    const start = new Date(startsAt)
    const end = new Date(endsAt)
    if (end <= start) {
      return NextResponse.json({ error: "End time must be after start time" }, { status: 400 })
    }

    const workspaceIds = await getUserWorkspaceIds(session.user.id)
    const workspaceId = workspaceIds[0]
    if (!workspaceId) {
      return NextResponse.json({ error: "No workspace found for user" }, { status: 403 })
    }

    // Double-booking guard: same room + overlapping active booking in any of the user's workspaces.
    const conflict = await prisma.roomBooking.findFirst({
      where: {
        workspaceId: { in: workspaceIds },
        room,
        status: "ACTIVE",
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      include: bookingInclude,
    })
    if (conflict) {
      return NextResponse.json(
        { error: `${room} sudah dibooking pada jam itu (${conflict.title}).`, conflict },
        { status: 409 }
      )
    }

    const booking = await prisma.roomBooking.create({
      data: {
        workspaceId,
        createdById: session.user.id,
        room,
        title: title.trim(),
        description: description?.trim() || null,
        startsAt: start,
        endsAt: end,
      },
      include: bookingInclude,
    })

    return NextResponse.json({ booking }, { status: 201 })
  } catch (error) {
    console.error("Room bookings POST error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}
