import prisma from "@/lib/prisma"
import { isSystemAdminUser } from "@/lib/rbac"
import type { Prisma, TeamCalendarEventStatus, WorkspaceRole } from "@/generated/prisma"

const MASTER_CALENDAR_UTC_OFFSET = "+07:00"

export type TeamCalendarTeamOption = {
  id: string
  name: string
  color: string
  workspaceId: string
  workspaceName: string
}

export async function getMasterCalendarTeamsForUser(userId: string): Promise<TeamCalendarTeamOption[]> {
  const isSystemAdmin = await isSystemAdminUser(userId)

  if (isSystemAdmin) {
    const teams = await prisma.team.findMany({
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ workspace: { name: "asc" } }, { name: "asc" }],
    })

    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      workspaceId: team.workspaceId,
      workspaceName: team.workspace.name,
    }))
  }

  const workspaceMemberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: {
      workspaceId: true,
      role: true,
    },
  })

  const adminWorkspaceIds = workspaceMemberships
    .filter((membership) => membership.role === "OWNER" || membership.role === "ADMIN")
    .map((membership) => membership.workspaceId)

  const memberWorkspaceIds = workspaceMemberships
    .filter((membership) => membership.role === "MEMBER")
    .map((membership) => membership.workspaceId)

  const scopes: Prisma.TeamWhereInput[] = []

  if (adminWorkspaceIds.length > 0) {
    scopes.push({ workspaceId: { in: adminWorkspaceIds } })
  }

  if (memberWorkspaceIds.length > 0) {
    scopes.push({
      workspaceId: { in: memberWorkspaceIds },
      members: {
        some: { userId },
      },
    })
  }

  if (scopes.length === 0) {
    return []
  }

  const teams = await prisma.team.findMany({
    where: scopes.length === 1 ? scopes[0] : { OR: scopes },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ workspace: { name: "asc" } }, { name: "asc" }],
  })

  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    color: team.color,
    workspaceId: team.workspaceId,
    workspaceName: team.workspace.name,
  }))
}

export async function getMasterCalendarTeamAccess(userId: string, teamId: string) {
  const [isSystemAdmin, team] = await Promise.all([
    isSystemAdminUser(userId),
    prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        color: true,
        workspaceId: true,
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
        members: {
          where: { userId },
          select: { role: true },
          take: 1,
        },
      },
    }),
  ])

  if (!team) {
    return {
      team: null,
      visible: false,
      canManage: false,
      workspaceRole: null as WorkspaceRole | null,
      isSystemAdmin,
    }
  }

  const workspaceMembership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId: team.workspaceId,
      },
    },
    select: { role: true },
  })

  const workspaceRole = workspaceMembership?.role ?? null
  const isWorkspaceAdmin = workspaceRole === "OWNER" || workspaceRole === "ADMIN"
  const isTeamMember = team.members.length > 0
  const visible = Boolean(isSystemAdmin || isWorkspaceAdmin || isTeamMember)

  return {
    team,
    visible,
    canManage: visible,
    workspaceRole,
    isSystemAdmin,
  }
}

function overlapsRange(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date
) {
  return leftStart < rightEnd && rightStart < leftEnd
}

function formatConflictLabel(start: Date, end: Date, isAllDay: boolean) {
  if (isAllDay) {
    return "Booked all day"
  }

  return `Booked ${Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(start)}-${Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(end)}`
}

export async function findBookedAttendeeConflicts(args: {
  workspaceId: string
  attendeeIds: string[]
  startsAt: Date
  endsAt: Date
  isAllDay: boolean
  excludeEventId?: string
}) {
  const { workspaceId, attendeeIds, startsAt, endsAt, excludeEventId } = args

  if (attendeeIds.length === 0) {
    return new Map<string, { eventId: string; reason: string }>()
  }

  const events = await prisma.teamCalendarEvent.findMany({
    where: {
      workspaceId,
      status: "ACTIVE",
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
      attendees: {
        some: {
          userId: { in: attendeeIds },
        },
      },
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      isAllDay: true,
      attendees: {
        where: {
          userId: { in: attendeeIds },
        },
        select: {
          userId: true,
        },
      },
    },
  })

  const conflicts = new Map<string, { eventId: string; reason: string }>()

  for (const event of events) {
    const eventStart = event.startsAt ?? startsAt
    const eventEnd = event.endsAt ?? event.startsAt ?? endsAt

    if (!eventStart || !eventEnd) continue
    if (!overlapsRange(startsAt, endsAt, eventStart, eventEnd)) continue

    for (const attendee of event.attendees) {
      if (!conflicts.has(attendee.userId)) {
        conflicts.set(attendee.userId, {
          eventId: event.id,
          reason: formatConflictLabel(eventStart, eventEnd, event.isAllDay),
        })
      }
    }
  }

  return conflicts
}

export async function getTeamAvailability(args: {
  actorId: string
  teamId: string
  startsAt: Date
  endsAt: Date
  isAllDay: boolean
  excludeEventId?: string
}) {
  const access = await getMasterCalendarTeamAccess(args.actorId, args.teamId)
  if (!access.team || !access.visible) {
    return { team: null, attendees: [], error: "Forbidden" as const }
  }

  const members = await prisma.teamMember.findMany({
    where: { teamId: args.teamId },
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
  })

  const conflicts = await findBookedAttendeeConflicts({
    workspaceId: access.team.workspaceId,
    attendeeIds: members.map((member) => member.userId),
    startsAt: args.startsAt,
    endsAt: args.endsAt,
    isAllDay: args.isAllDay,
    excludeEventId: args.excludeEventId,
  })

  return {
    team: access.team,
    attendees: members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      avatar: member.user.avatar,
      role: member.role,
      available: !conflicts.has(member.user.id),
      reason: conflicts.get(member.user.id)?.reason ?? null,
    })),
    error: null,
  }
}

export function normalizeMasterCalendarRange(input: {
  date: string
  isAllDay: boolean
  startTime?: string | null
  endTime?: string | null
}) {
  const baseDate = new Date(`${input.date}T00:00:00${MASTER_CALENDAR_UTC_OFFSET}`)

  if (Number.isNaN(baseDate.getTime())) {
    throw new Error("Invalid date")
  }

  if (input.isAllDay) {
    const startsAt = new Date(baseDate)
    const endsAt = new Date(baseDate)
    endsAt.setDate(endsAt.getDate() + 1)
    return { startsAt, endsAt }
  }

  if (!input.startTime || !input.endTime) {
    throw new Error("Start time and end time are required")
  }

  const startsAt = new Date(`${input.date}T${input.startTime}:00${MASTER_CALENDAR_UTC_OFFSET}`)
  const endsAt = new Date(`${input.date}T${input.endTime}:00${MASTER_CALENDAR_UTC_OFFSET}`)

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error("Invalid start or end time")
  }

  if (endsAt <= startsAt) {
    throw new Error("End time must be after start time")
  }

  return { startsAt, endsAt }
}

export async function canAccessMasterCalendarEvent(userId: string, eventId: string) {
  const event = await prisma.teamCalendarEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      teamId: true,
      workspaceId: true,
      createdById: true,
    },
  })

  if (!event) {
    return { event: null, visible: false, canManage: false }
  }

  const teamAccess = await getMasterCalendarTeamAccess(userId, event.teamId)

  return {
    event,
    visible: teamAccess.visible,
    canManage: teamAccess.canManage,
  }
}

export function isActiveTeamCalendarEventStatus(status: TeamCalendarEventStatus) {
  return status === "ACTIVE"
}
