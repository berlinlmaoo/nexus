export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import {
  findBookedAttendeeConflicts,
  getMasterCalendarTeamAccess,
  normalizeMasterCalendarRange,
} from "@/lib/master-calendar"
import {
  createMasterCalendarEventSchema,
  validateBody,
} from "@/lib/validations"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const teamId = searchParams.get("teamId")
    const rangeStart = searchParams.get("rangeStart")
    const rangeEnd = searchParams.get("rangeEnd")

    if (!teamId || !rangeStart || !rangeEnd) {
      return NextResponse.json({ error: "teamId, rangeStart, and rangeEnd are required" }, { status: 400 })
    }

    const access = await getMasterCalendarTeamAccess(session.user.id, teamId)
    if (!access.team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 })
    }
    if (!access.visible) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const start = new Date(rangeStart)
    const end = new Date(rangeEnd)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 })
    }

    const events = await prisma.teamCalendarEvent.findMany({
      where: {
        teamId,
        status: "ACTIVE",
        OR: [
          {
            startsAt: {
              gte: start,
              lte: end,
            },
          },
          {
            endsAt: {
              gte: start,
              lte: end,
            },
          },
          {
            AND: [
              { startsAt: { lte: start } },
              { endsAt: { gte: end } },
            ],
          },
        ],
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
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    })

    return NextResponse.json({ events })
  } catch (error) {
    console.error("Master calendar GET error:", error)
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
    const validation = validateBody(createMasterCalendarEventSchema, body)
    if (!validation.success) {
      return validation.error
    }

    const {
      teamId,
      title,
      date,
      isAllDay = false,
      startTime,
      endTime,
      attendeeIds = [],
      location,
      description,
    } = validation.data

    const access = await getMasterCalendarTeamAccess(session.user.id, teamId)
    if (!access.team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 })
    }
    if (!access.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { startsAt, endsAt } = normalizeMasterCalendarRange({
      date,
      isAllDay,
      startTime,
      endTime,
    })

    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true },
    })
    const allowedAttendeeIds = new Set(teamMembers.map((member) => member.userId))
    const normalizedAttendeeIds = Array.from(new Set(attendeeIds))

    if (normalizedAttendeeIds.some((attendeeId) => !allowedAttendeeIds.has(attendeeId))) {
      return NextResponse.json({ error: "Attendees must belong to the selected team" }, { status: 400 })
    }

    const conflicts = await findBookedAttendeeConflicts({
      workspaceId: access.team.workspaceId,
      attendeeIds: normalizedAttendeeIds,
      startsAt,
      endsAt,
      isAllDay,
    })

    if (conflicts.size > 0) {
      const bookedUserIds = Array.from(conflicts.keys())
      return NextResponse.json(
        {
          error: "One or more attendees are already booked in this time slot",
          conflicts: bookedUserIds.map((userId) => ({
            userId,
            reason: conflicts.get(userId)?.reason ?? "Booked",
          })),
        },
        { status: 409 }
      )
    }

    const event = await prisma.teamCalendarEvent.create({
      data: {
        teamId,
        workspaceId: access.team.workspaceId,
        createdById: session.user.id,
        title: title.trim(),
        description: description?.trim() || null,
        location: location?.trim() || null,
        startsAt,
        endsAt,
        isAllDay,
        attendees: normalizedAttendeeIds.length
          ? {
              createMany: {
                data: normalizedAttendeeIds.map((userId) => ({ userId })),
                skipDuplicates: true,
              },
            }
          : undefined,
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

    return NextResponse.json({ event }, { status: 201 })
  } catch (error) {
    console.error("Master calendar POST error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}
