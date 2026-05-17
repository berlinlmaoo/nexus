export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import {
  canAccessMasterCalendarEvent,
  findBookedAttendeeConflicts,
  formatMasterCalendarDateInput,
  formatMasterCalendarTimeInput,
  getMasterCalendarTeamAccess,
  normalizeMasterCalendarRange,
} from "@/lib/master-calendar"
import {
  updateMasterCalendarEventSchema,
  validateBody,
} from "@/lib/validations"

export async function PATCH(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const access = await canAccessMasterCalendarEvent(session.user.id, params.eventId)
    if (!access.event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 })
    }
    if (!access.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await req.json()
    const validation = validateBody(updateMasterCalendarEventSchema, body)
    if (!validation.success) {
      return validation.error
    }

    const existing = await prisma.teamCalendarEvent.findUnique({
      where: { id: params.eventId },
      include: {
        attendees: {
          select: { userId: true },
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 })
    }

    const nextTeamId = validation.data.teamId ?? existing.teamId
    const teamAccess = await getMasterCalendarTeamAccess(session.user.id, nextTeamId)
    if (!teamAccess.team || !teamAccess.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const nextIsAllDay = validation.data.isAllDay ?? existing.isAllDay
    const nextDate = validation.data.date ?? (existing.startsAt ? formatMasterCalendarDateInput(existing.startsAt) : null)

    if (!nextDate) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 })
    }

    const existingStartTime = existing.startsAt
      ? formatMasterCalendarTimeInput(existing.startsAt)
      : null
    const existingEndTime = existing.endsAt
      ? formatMasterCalendarTimeInput(existing.endsAt)
      : null

    const { startsAt, endsAt } = normalizeMasterCalendarRange({
      date: nextDate,
      isAllDay: nextIsAllDay,
      startTime: validation.data.startTime ?? existingStartTime,
      endTime: validation.data.endTime ?? existingEndTime,
    })

    const nextAttendeeIds = Array.from(
      new Set(validation.data.attendeeIds ?? existing.attendees.map((attendee) => attendee.userId))
    )

    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId: nextTeamId },
      select: { userId: true },
    })
    const allowedAttendeeIds = new Set(teamMembers.map((member) => member.userId))

    if (nextAttendeeIds.some((attendeeId) => !allowedAttendeeIds.has(attendeeId))) {
      return NextResponse.json({ error: "Attendees must belong to the selected team" }, { status: 400 })
    }

    const nextStatus = validation.data.status ?? existing.status

    if (nextStatus !== "CANCELLED") {
      const conflicts = await findBookedAttendeeConflicts({
        workspaceId: teamAccess.team.workspaceId,
        attendeeIds: nextAttendeeIds,
        startsAt,
        endsAt,
        isAllDay: nextIsAllDay,
        excludeEventId: existing.id,
      })

      if (conflicts.size > 0) {
        return NextResponse.json(
          {
            error: "One or more attendees are already booked in this time slot",
            conflicts: Array.from(conflicts.entries()).map(([userId, detail]) => ({
              userId,
              reason: detail.reason,
            })),
          },
          { status: 409 }
        )
      }
    }

    const event = await prisma.teamCalendarEvent.update({
      where: { id: existing.id },
      data: {
        teamId: nextTeamId,
        workspaceId: teamAccess.team.workspaceId,
        title: validation.data.title?.trim() ?? existing.title,
        description:
          validation.data.description !== undefined
            ? validation.data.description?.trim() || null
            : existing.description,
        location:
          validation.data.location !== undefined
            ? validation.data.location?.trim() || null
            : existing.location,
        startsAt,
        endsAt,
        isAllDay: nextIsAllDay,
        status: nextStatus,
        attendees: {
          deleteMany: {},
          ...(nextAttendeeIds.length
            ? {
                createMany: {
                  data: nextAttendeeIds.map((userId) => ({ userId })),
                  skipDuplicates: true,
                },
              }
            : {}),
        },
      },
      include: {
        attendees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
          },
          orderBy: {
            user: {
              name: "asc",
            },
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    })

    return NextResponse.json({ event })
  } catch (error) {
    console.error("Master calendar PATCH error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const access = await canAccessMasterCalendarEvent(session.user.id, params.eventId)
    if (!access.event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 })
    }
    if (!access.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    await prisma.teamCalendarEvent.update({
      where: { id: params.eventId },
      data: { status: "CANCELLED" },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Master calendar DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
