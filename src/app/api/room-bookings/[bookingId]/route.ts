export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateRoomBookingSchema, validateBody } from "@/lib/validations"
import { deleteRoomBooking, updateRoomBooking } from "@/lib/room-booking"

/**
 * PATCH/DELETE one booking. The rules (who may, the conflict guard and the database's exclusion constraint,
 * the owner told when a manager changed it, the Audit copy on delete) live in lib/room-booking.ts, shared with
 * GIDEON's move_room_booking / cancel_room_booking (16 Oct 2026). A booking can be edited/deleted by its
 * creator, or by a workspace MANAGER/BoD/One-Above-All.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { bookingId } = await params
    const body = await req.json().catch(() => null)
    const validation = validateBody(updateRoomBookingSchema, body)
    if (!validation.success) {
      return validation.error
    }

    const data = validation.data
    const result = await updateRoomBooking({
      userId: session.user.id,
      bookingId,
      patch: {
        ...(data.room !== undefined ? { room: data.room } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.startsAt !== undefined ? { startsAt: new Date(data.startsAt) } : {}),
        ...(data.endsAt !== undefined ? { endsAt: new Date(data.endsAt) } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    })
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json({ booking: result.booking })
  } catch (error) {
    console.error("Room booking PATCH error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { bookingId } = await params
    const result = await deleteRoomBooking({ userId: session.user.id, bookingId, request: _req })
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Room booking DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
