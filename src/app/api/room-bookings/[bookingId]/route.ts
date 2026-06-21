export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getUserWorkspaceIds } from "@/lib/workspace-scope"
import { isWorkspaceManagerRole } from "@/lib/rbac"
import { updateRoomBookingSchema, validateBody } from "@/lib/validations"

/** A booking can be edited/deleted by its creator, or by a workspace MANAGER/BoD/One-Above-All. */
async function canManageBooking(userId: string, workspaceId: string, createdById: string): Promise<boolean> {
  if (createdById === userId) return true
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  })
  return isWorkspaceManagerRole(membership?.role ?? null)
}

const bookingInclude = {
  createdBy: { select: { id: true, name: true, email: true, avatar: true } },
} as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { bookingId } = await params
    const body = await req.json()
    const validation = validateBody(updateRoomBookingSchema, body)
    if (!validation.success) {
      return validation.error
    }

    const workspaceIds = await getUserWorkspaceIds(session.user.id)
    const existing = await prisma.roomBooking.findFirst({
      where: { id: bookingId, workspaceId: { in: workspaceIds } },
    })
    if (!existing) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }
    if (!(await canManageBooking(session.user.id, existing.workspaceId, existing.createdById))) {
      return NextResponse.json({ error: "Cuma pembuat booking atau manager yang bisa ubah booking ini." }, { status: 403 })
    }

    const data = validation.data
    const nextRoom = data.room ?? existing.room
    const nextStart = data.startsAt ? new Date(data.startsAt) : existing.startsAt
    const nextEnd = data.endsAt ? new Date(data.endsAt) : existing.endsAt
    if (nextEnd <= nextStart) {
      return NextResponse.json({ error: "End time must be after start time" }, { status: 400 })
    }

    const nextStatus = data.status ?? existing.status
    if (nextStatus === "ACTIVE") {
      const conflict = await prisma.roomBooking.findFirst({
        where: {
          id: { not: bookingId },
          workspaceId: { in: workspaceIds },
          room: nextRoom,
          status: "ACTIVE",
          startsAt: { lt: nextEnd },
          endsAt: { gt: nextStart },
        },
      })
      if (conflict) {
        return NextResponse.json({ error: `${nextRoom} sudah dibooking pada jam itu (${conflict.title}).` }, { status: 409 })
      }
    }

    const booking = await prisma.roomBooking.update({
      where: { id: bookingId },
      data: {
        ...(data.room !== undefined ? { room: data.room } : {}),
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.startsAt !== undefined ? { startsAt: nextStart } : {}),
        ...(data.endsAt !== undefined ? { endsAt: nextEnd } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      include: bookingInclude,
    })

    return NextResponse.json({ booking })
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
    const workspaceIds = await getUserWorkspaceIds(session.user.id)
    const existing = await prisma.roomBooking.findFirst({
      where: { id: bookingId, workspaceId: { in: workspaceIds } },
      select: { id: true, workspaceId: true, createdById: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }
    if (!(await canManageBooking(session.user.id, existing.workspaceId, existing.createdById))) {
      return NextResponse.json({ error: "Cuma pembuat booking atau manager yang bisa hapus booking ini." }, { status: 403 })
    }

    await prisma.roomBooking.delete({ where: { id: bookingId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Room booking DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
