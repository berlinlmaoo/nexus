export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { Prisma } from '@/generated/prisma'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { syncTeamProjectAccess, syncTeamMemberAccess, revokeTeamProjectAccess, revokeTeamMemberAccess } from '@/lib/team-sync'
import { logAudit } from '@/lib/audit'
import { getPrimaryWorkspaceDefaults } from '@/lib/workspace-defaults'
import { isPrimaryTeamName, isPrimaryWorkspace } from '@/lib/primary-team'
import { isSystemAdminUser } from '@/lib/rbac'
import { canonicalEmail } from '@/lib/email-auth'

async function getTeamContext(teamId: string, actorId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      attendanceShiftOverrideEnabled: true,
      attendanceShiftStartTime: true,
      attendanceShiftEndTime: true,
      workspaceId: true,
      workspace: {
        select: {
          slug: true,
          name: true,
        },
      },
    },
  })

  if (!team) {
    return { team: null, workspaceMembership: null, canManage: false }
  }

  const workspaceMembership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: actorId,
        workspaceId: team.workspaceId,
      },
    },
    select: { role: true, attendanceRole: true },
  })

  const isSystemAdmin = await isSystemAdminUser(actorId)
  const canManage = Boolean(
    isSystemAdmin ||
      (workspaceMembership &&
        (workspaceMembership.role === 'BOD' ||
          workspaceMembership.role === 'MANAGER' || workspaceMembership.role === 'ONE_ABOVE_ALL'))
  )
  const canManageAttendanceSettings = Boolean(
    isSystemAdmin ||
      (workspaceMembership &&
        (workspaceMembership.role === 'BOD' ||
          workspaceMembership.role === 'MANAGER' || workspaceMembership.role === 'ONE_ABOVE_ALL' ||
          workspaceMembership.attendanceRole === 'SUPERVISOR'))
  )

  return { team, workspaceMembership, canManage, canManageAttendanceSettings, isSystemAdmin }
}

async function canManageWorkspace(workspaceId: string, actorId: string) {
  const isSystemAdmin = await isSystemAdminUser(actorId)
  if (isSystemAdmin) return true
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: actorId, workspaceId } },
    select: { role: true },
  })
  return Boolean(membership && (membership.role === 'BOD' || membership.role === 'MANAGER' || membership.role === 'ONE_ABOVE_ALL'))
}

function normalizeTeamName(name: string) {
  return name.trim().toLowerCase()
}

function normalizeRequestedEmails(value: unknown) {
  const rawEmails = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return Array.from(
    new Set(
      rawEmails
        .map((email) => canonicalEmail(String(email)))
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
  )
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const isSystemAdmin = await isSystemAdminUser(user.id)

    const workspaceMemberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { workspaceId: true, role: true, attendanceRole: true },
    })

    // Division list (grouping layer above teams). Returned to all members so the
    // grouped Crew Hub view can render section headers; only BoD/Manager edit them.
    if (req.nextUrl.searchParams.get('resource') === 'divisions') {
      const divisionScope = isSystemAdmin
        ? {}
        : { workspaceId: { in: workspaceMemberships.map((m) => m.workspaceId) } }
      const divisions = await prisma.division.findMany({
        where: divisionScope,
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      })
      return NextResponse.json(divisions)
    }

    const adminWorkspaceIds = workspaceMemberships
      .filter((membership) => membership.role === 'BOD' || membership.role === 'MANAGER' || membership.role === 'ONE_ABOVE_ALL')
      .map((membership) => membership.workspaceId)

    const memberWorkspaceIds = workspaceMemberships
      .filter((membership) => membership.role === 'STAFF')
      .map((membership) => membership.workspaceId)

    const attendanceSupervisorWorkspaceIds = workspaceMemberships
      .filter((membership) => membership.attendanceRole === 'SUPERVISOR')
      .map((membership) => membership.workspaceId)

    const teamScopes: Prisma.TeamWhereInput[] = []
    if (isSystemAdmin) {
      teamScopes.push({})
    }
    if (adminWorkspaceIds.length > 0) {
      teamScopes.push({ workspaceId: { in: adminWorkspaceIds } })
    }
    if (attendanceSupervisorWorkspaceIds.length > 0) {
      teamScopes.push({ workspaceId: { in: attendanceSupervisorWorkspaceIds } })
    }
    if (memberWorkspaceIds.length > 0) {
      teamScopes.push({
        workspaceId: { in: memberWorkspaceIds },
        members: { some: { userId: user.id } },
      })
    }

    if (teamScopes.length === 0) {
      return NextResponse.json([])
    }

    // Workspace isolation: members only see teams they belong to, owners/admins see all teams in their workspace
    const rawTeams = await prisma.team.findMany({
      where: teamScopes.length === 1 ? teamScopes[0] : { OR: teamScopes },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } }
          }
        },
        workspace: {
          select: {
            slug: true,
            name: true,
          },
        },
        division: { select: { id: true, name: true, color: true } },
        projects: {
          include: {
            project: { select: { id: true, name: true, color: true, icon: true, status: true } }
          }
        }
      },
      orderBy: { name: 'asc' }
    })

    const teamsByKey = new Map<string, typeof rawTeams[number][]>()

    for (const team of rawTeams) {
      const key = `${team.workspaceId}:${normalizeTeamName(team.name)}`
      const bucket = teamsByKey.get(key) ?? []
      bucket.push(team)
      teamsByKey.set(key, bucket)
    }

    const teams = Array.from(teamsByKey.values()).map((bucket) => {
      const sorted = [...bucket].sort((left, right) => {
        const leftHasUser = left.members.some((member) => member.user.id === user.id)
        const rightHasUser = right.members.some((member) => member.user.id === user.id)
        if (leftHasUser !== rightHasUser) return leftHasUser ? -1 : 1
        if (left.members.length !== right.members.length) return right.members.length - left.members.length
        if (left.projects.length !== right.projects.length) return right.projects.length - left.projects.length
        return left.id.localeCompare(right.id)
      })

      return sorted[0]
    }).map((team) => ({
      ...team,
      isPrimaryTeam: isPrimaryWorkspace(team.workspace) && isPrimaryTeamName(team.name),
      canManage: isSystemAdmin || adminWorkspaceIds.includes(team.workspaceId),
      canManageAttendanceSettings:
        isSystemAdmin || adminWorkspaceIds.includes(team.workspaceId) || attendanceSupervisorWorkspaceIds.includes(team.workspaceId),
    }))

    return NextResponse.json(teams)
  } catch (error) {
    console.error('Teams GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    const user = session?.user
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()

    // Handle link/unlink project actions
    if (body.action === 'link-project') {
      const { teamId, projectId } = body
      if (!teamId || !projectId) {
        console.warn('Teams POST link-project validation failed', { teamId, projectId, actorId: user.id })
        return NextResponse.json({ error: 'teamId and projectId are required' }, { status: 400 })
      }

      const { team, canManage } = await getTeamContext(teamId, user.id)
      if (!team || !canManage) {
        console.warn('Teams POST link-project forbidden', { teamId, projectId, actorId: user.id })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, workspaceId: true, name: true, color: true, icon: true, status: true },
      })

      if (!project || project.workspaceId !== team.workspaceId) {
        console.warn('Teams POST link-project cross-workspace rejected', { teamId, projectId, actorId: user.id, teamWorkspaceId: team.workspaceId, projectWorkspaceId: project?.workspaceId })
        return NextResponse.json({ error: 'Project must belong to the same workspace as the team' }, { status: 400 })
      }

      const teamMembers = await prisma.teamMember.findMany({
        where: { teamId },
        select: { userId: true },
      })

      if (teamMembers.length > 0) {
        await prisma.workspaceMember.createMany({
          data: teamMembers.map((member) => ({
            userId: member.userId,
            workspaceId: team.workspaceId,
            role: 'STAFF',
          })),
          skipDuplicates: true,
        })
      }

      const link = await prisma.teamProject.upsert({
        where: { teamId_projectId: { teamId, projectId } },
        create: { teamId, projectId },
        update: {},
        include: { project: { select: { id: true, name: true, color: true, icon: true, status: true } } }
      })
      // Propagate: grant all team members access to this project
      await syncTeamProjectAccess(teamId, projectId)
      logAudit({ action: "create", entityType: "team_project_link", entityId: link.id ?? teamId, entityName: `${teamId}:${projectId}`, userId: user.id, request: req, metadata: { teamId, projectId } })
      return NextResponse.json(link, { status: 201 })
    }

    if (body.action === 'unlink-project') {
      const { teamId, projectId } = body
      if (!teamId || !projectId) {
        console.warn('Teams POST unlink-project validation failed', { teamId, projectId, actorId: user.id })
        return NextResponse.json({ error: 'teamId and projectId are required' }, { status: 400 })
      }

      const { team, canManage } = await getTeamContext(teamId, user.id)
      if (!team || !canManage) {
        console.warn('Teams POST unlink-project forbidden', { teamId, projectId, actorId: user.id })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Revoke team-propagated access before unlinking
      await revokeTeamProjectAccess(teamId, projectId)
      await prisma.teamProject.deleteMany({ where: { teamId, projectId } })
      logAudit({ action: "delete", entityType: "team_project_link", entityId: teamId, entityName: `${teamId}:${projectId}`, userId: user.id, request: req, metadata: { teamId, projectId } })
      return NextResponse.json({ unlinked: true })
    }

    // Handle add/remove member actions
    if (body.action === 'add-member') {
      const { teamId, userId, userIds, email, emails } = body
      const requestedUserIds = Array.from(
        new Set(
          (Array.isArray(userIds) ? userIds : userId ? [userId] : []).filter(
            (value): value is string => typeof value === 'string' && value.length > 0
          )
        )
      )
      const requestedEmails = normalizeRequestedEmails(emails ?? email)

      if (!teamId || (requestedUserIds.length === 0 && requestedEmails.length === 0)) {
        console.warn('Teams POST add-member validation failed', { teamId, memberId: userId, memberIds: userIds, emails: requestedEmails, actorId: user.id })
        return NextResponse.json({ error: 'teamId and at least one userId or email are required' }, { status: 400 })
      }

      const { team, canManage } = await getTeamContext(teamId, user.id)
      if (!team || !canManage) {
        console.warn('Teams POST add-member forbidden', { teamId, memberIds: requestedUserIds, actorId: user.id })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const usersById = requestedUserIds.length > 0 ? await prisma.user.findMany({
        where: { id: { in: requestedUserIds } },
        select: { id: true, name: true, email: true, avatar: true },
      }) : []

      if (usersById.length !== requestedUserIds.length) {
        console.warn('Teams POST add-member user missing', { teamId, memberIds: requestedUserIds, actorId: user.id })
        return NextResponse.json({ error: 'One or more users were not found' }, { status: 404 })
      }

      const usersByEmail = []
      for (const requestedEmail of requestedEmails) {
        let targetUser = await prisma.user.findFirst({
          where: { email: { equals: requestedEmail, mode: 'insensitive' } },
          select: { id: true, name: true, email: true, avatar: true },
        })

        if (!targetUser) {
          const temporaryPassword = await bcrypt.hash(Math.random().toString(36).slice(2) + 'Aa1!', 12)
          targetUser = await prisma.user.create({
            data: {
              email: requestedEmail,
              name: requestedEmail.split('@')[0],
              password: temporaryPassword,
            },
            select: { id: true, name: true, email: true, avatar: true },
          })
        }

        usersByEmail.push(targetUser)
      }

      const targetUsers = Array.from(
        new Map([...usersById, ...usersByEmail].map((targetUser) => [targetUser.id, targetUser])).values()
      )
      const targetUserIds = targetUsers.map((targetUser) => targetUser.id)

      await prisma.workspaceMember.createMany({
        data: targetUserIds.map((memberId) => ({
          userId: memberId,
          workspaceId: team.workspaceId,
          role: 'STAFF',
        })),
        skipDuplicates: true,
      })

      await prisma.teamMember.createMany({
        data: targetUserIds.map((memberId) => ({
          teamId,
          userId: memberId,
          isAttendancePrimary: false,
        })),
        skipDuplicates: true,
      })

      for (const memberId of targetUserIds) {
        await syncTeamMemberAccess(teamId, memberId)
        logAudit({
          action: "create",
          entityType: "team_member",
          entityId: teamId,
          entityName: `${teamId}:${memberId}`,
          userId: user.id,
          request: req,
          metadata: { teamId, memberId, invitedByEmail: requestedEmails.length > 0 },
        })
      }

      return NextResponse.json({
        added: targetUsers.length,
        members: targetUsers,
      }, { status: 201 })
    }

    if (body.action === 'remove-member') {
      const { teamId, userId } = body
      if (!teamId || !userId) {
        console.warn('Teams POST remove-member validation failed', { teamId, memberId: userId, actorId: user.id })
        return NextResponse.json({ error: 'teamId and userId are required' }, { status: 400 })
      }

      const { team, canManage } = await getTeamContext(teamId, user.id)
      if (!team || !canManage) {
        console.warn('Teams POST remove-member forbidden', { teamId, memberId: userId, actorId: user.id })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      if (isPrimaryWorkspace(team.workspace) && isPrimaryTeamName(team.name)) {
        return NextResponse.json({ error: 'Members of PATS Group cannot be removed from the required primary team' }, { status: 400 })
      }

      // Revoke team-propagated project access before removing member
      await revokeTeamMemberAccess(teamId, userId)
      await prisma.teamMember.deleteMany({ where: { teamId, userId } })
      logAudit({ action: "delete", entityType: "team_member", entityId: teamId, entityName: `${teamId}:${userId}`, userId: user.id, request: req, metadata: { teamId, memberId: userId } })
      return NextResponse.json({ removed: true })
    }

    if (body.action === 'delete-team') {
      const { teamId } = body
      if (!teamId) {
        console.warn('Teams POST delete-team validation failed', { teamId, actorId: user.id })
        return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
      }

      const { team, canManage } = await getTeamContext(teamId, user.id)
      if (!team || !canManage) {
        console.warn('Teams POST delete-team forbidden', { teamId, actorId: user.id })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      if (isPrimaryWorkspace(team.workspace) && isPrimaryTeamName(team.name)) {
        return NextResponse.json({ error: 'The required PATS Group team cannot be deleted' }, { status: 400 })
      }

      const existingTeam = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          projects: {
            select: { projectId: true },
          },
        },
      })

      if (!existingTeam) {
        return NextResponse.json({ error: 'Team not found' }, { status: 404 })
      }

      for (const teamProject of existingTeam.projects) {
        await revokeTeamProjectAccess(teamId, teamProject.projectId)
      }

      await prisma.team.delete({
        where: { id: teamId },
      })

      logAudit({
        action: "delete",
        entityType: "team",
        entityId: teamId,
        entityName: existingTeam.name,
        userId: user.id,
        request: req,
        metadata: { workspaceId: existingTeam.workspaceId },
      })

      return NextResponse.json({ deleted: true })
    }

    if (body.action === 'update-attendance-shift') {
      const { teamId, attendanceShiftOverrideEnabled, attendanceShiftStartTime, attendanceShiftEndTime } = body
      if (!teamId) {
        return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
      }

      const { team, canManageAttendanceSettings } = await getTeamContext(teamId, user.id)
      if (!team || !canManageAttendanceSettings) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      if (
        attendanceShiftOverrideEnabled &&
        (
          typeof attendanceShiftStartTime !== 'string' ||
          typeof attendanceShiftEndTime !== 'string' ||
          !/^\d{2}:\d{2}$/.test(attendanceShiftStartTime) ||
          !/^\d{2}:\d{2}$/.test(attendanceShiftEndTime)
        )
      ) {
        return NextResponse.json({ error: 'Valid team shift start and end time are required' }, { status: 400 })
      }

      const updatedTeam = await prisma.team.update({
        where: { id: teamId },
        data: {
          attendanceShiftOverrideEnabled: Boolean(attendanceShiftOverrideEnabled),
          attendanceShiftStartTime: attendanceShiftOverrideEnabled ? attendanceShiftStartTime : null,
          attendanceShiftEndTime: attendanceShiftOverrideEnabled ? attendanceShiftEndTime : null,
        },
      })

      logAudit({
        action: "update",
        entityType: "team_attendance_shift",
        entityId: updatedTeam.id,
        entityName: updatedTeam.name,
        userId: user.id,
        request: req,
        metadata: {
          attendanceShiftOverrideEnabled: updatedTeam.attendanceShiftOverrideEnabled,
          attendanceShiftStartTime: updatedTeam.attendanceShiftStartTime,
          attendanceShiftEndTime: updatedTeam.attendanceShiftEndTime,
        },
      })

      return NextResponse.json({ team: updatedTeam })
    }

    if (body.action === 'set-attendance-primary') {
      const { teamId, userId, isAttendancePrimary } = body
      if (!teamId || !userId || typeof isAttendancePrimary !== 'boolean') {
        return NextResponse.json({ error: 'teamId, userId, and isAttendancePrimary are required' }, { status: 400 })
      }

      const { team, canManageAttendanceSettings } = await getTeamContext(teamId, user.id)
      if (!team || !canManageAttendanceSettings) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const membership = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })

      if (!membership) {
        return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
      }

      await prisma.$transaction(async (tx) => {
        if (isAttendancePrimary) {
          await tx.teamMember.updateMany({
            where: {
              userId,
              attendancePrimaryWorkspaceId: team.workspaceId,
            },
            data: {
              isAttendancePrimary: false,
              attendancePrimaryWorkspaceId: null,
            },
          })
        }

        await tx.teamMember.update({
          where: {
            teamId_userId: {
              teamId,
              userId,
            },
          },
          data: {
            isAttendancePrimary,
            attendancePrimaryWorkspaceId: isAttendancePrimary ? team.workspaceId : null,
          },
        })
      })

      logAudit({
        action: "update",
        entityType: "team_member_attendance_primary",
        entityId: `${teamId}:${userId}`,
        entityName: `${team.name}:${userId}`,
        userId: user.id,
        request: req,
        metadata: {
          teamId,
          memberId: userId,
          workspaceId: team.workspaceId,
          isAttendancePrimary,
        },
      })

      return NextResponse.json({ updated: true })
    }

    if (body.action === 'set-member-role') {
      const { teamId, userId, role } = body
      if (!teamId || !userId || (role !== 'LEAD' && role !== 'MEMBER')) {
        return NextResponse.json({ error: 'teamId, userId, and role (LEAD|MEMBER) are required' }, { status: 400 })
      }

      const { team, canManageAttendanceSettings } = await getTeamContext(teamId, user.id)
      if (!team || !canManageAttendanceSettings) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const membership = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
      })
      if (!membership) {
        return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
      }

      await prisma.teamMember.update({
        where: { teamId_userId: { teamId, userId } },
        data: { role },
      })

      logAudit({
        action: "update",
        entityType: "team_member_role",
        entityId: `${teamId}:${userId}`,
        entityName: `${team.name}:${userId}`,
        userId: user.id,
        request: req,
        metadata: { teamId, memberId: userId, workspaceId: team.workspaceId, role },
      })

      return NextResponse.json({ updated: true })
    }

    if (body.action === 'create-division') {
      const divisionName = typeof body.name === 'string' ? body.name.trim() : ''
      const divisionColor = typeof body.color === 'string' ? body.color : undefined
      if (!divisionName) return NextResponse.json({ error: 'Division name is required' }, { status: 400 })

      const adminMembership = await prisma.workspaceMember.findFirst({
        where: { userId: user.id, role: { in: ['ONE_ABOVE_ALL', 'BOD', 'MANAGER'] } },
        select: { workspaceId: true },
      })
      const targetWorkspaceId = body.workspaceId || adminMembership?.workspaceId
      if (!targetWorkspaceId || !(await canManageWorkspace(targetWorkspaceId, user.id))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const existing = await prisma.division.findFirst({
        where: { workspaceId: targetWorkspaceId, name: { equals: divisionName, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existing) return NextResponse.json({ error: 'A division with this name already exists' }, { status: 409 })

      const maxPos = await prisma.division.aggregate({
        where: { workspaceId: targetWorkspaceId },
        _max: { position: true },
      })
      const division = await prisma.division.create({
        data: {
          name: divisionName,
          color: divisionColor || '#64748B',
          position: (maxPos._max.position ?? -1) + 1,
          workspaceId: targetWorkspaceId,
        },
      })
      logAudit({ action: 'create', entityType: 'division', entityId: division.id, entityName: division.name, userId: user.id, request: req, metadata: { workspaceId: targetWorkspaceId } })
      return NextResponse.json(division, { status: 201 })
    }

    if (body.action === 'update-division') {
      const { divisionId } = body
      if (!divisionId) return NextResponse.json({ error: 'divisionId is required' }, { status: 400 })
      const division = await prisma.division.findUnique({ where: { id: divisionId }, select: { workspaceId: true, name: true } })
      if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
      if (!(await canManageWorkspace(division.workspaceId, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

      const data: Prisma.DivisionUpdateInput = {}
      if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
      if (typeof body.color === 'string') data.color = body.color
      if (typeof body.position === 'number') data.position = body.position

      if (data.name && data.name !== division.name) {
        const clash = await prisma.division.findFirst({
          where: { workspaceId: division.workspaceId, name: { equals: data.name as string, mode: 'insensitive' }, id: { not: divisionId } },
          select: { id: true },
        })
        if (clash) return NextResponse.json({ error: 'A division with this name already exists' }, { status: 409 })
      }

      const updated = await prisma.division.update({ where: { id: divisionId }, data })
      logAudit({ action: 'update', entityType: 'division', entityId: updated.id, entityName: updated.name, userId: user.id, request: req })
      return NextResponse.json(updated)
    }

    if (body.action === 'delete-division') {
      const { divisionId } = body
      if (!divisionId) return NextResponse.json({ error: 'divisionId is required' }, { status: 400 })
      const division = await prisma.division.findUnique({ where: { id: divisionId }, select: { workspaceId: true, name: true } })
      if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
      if (!(await canManageWorkspace(division.workspaceId, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

      // Teams keep existing — their divisionId is set to null via onDelete: SetNull.
      await prisma.division.delete({ where: { id: divisionId } })
      logAudit({ action: 'delete', entityType: 'division', entityId: divisionId, entityName: division.name, userId: user.id, request: req, metadata: { workspaceId: division.workspaceId } })
      return NextResponse.json({ deleted: true })
    }

    if (body.action === 'set-team-division') {
      const { teamId } = body
      const divisionId: string | null = body.divisionId ?? null
      if (!teamId) return NextResponse.json({ error: 'teamId is required' }, { status: 400 })

      const { team, canManage } = await getTeamContext(teamId, user.id)
      if (!team || !canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

      if (divisionId) {
        const division = await prisma.division.findUnique({ where: { id: divisionId }, select: { workspaceId: true } })
        if (!division || division.workspaceId !== team.workspaceId) {
          return NextResponse.json({ error: 'Division must belong to the same workspace as the team' }, { status: 400 })
        }
      }

      await prisma.team.update({ where: { id: teamId }, data: { divisionId } })
      logAudit({ action: 'update', entityType: 'team_division', entityId: teamId, entityName: team.name, userId: user.id, request: req, metadata: { teamId, divisionId } })
      return NextResponse.json({ updated: true, divisionId })
    }

    // Default: create team
    const { name, color } = body
    if (!name) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
    const isSystemAdmin = await isSystemAdminUser(user.id)

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id }
    })

    if (!isSystemAdmin && (!membership || (membership.role !== 'BOD' && membership.role !== 'MANAGER' && membership.role !== 'ONE_ABOVE_ALL'))) {
      return NextResponse.json({ error: 'Only workspace owners/admins can create teams' }, { status: 403 })
    }

    if (!membership) {
      const primaryWorkspaceDefaults = getPrimaryWorkspaceDefaults()
      const workspace = await prisma.workspace.upsert({
        where: { slug: primaryWorkspaceDefaults.slug },
        update: {},
        create: primaryWorkspaceDefaults,
        select: { id: true }
      })

      await prisma.workspaceMember.upsert({
        where: {
          userId_workspaceId: {
            userId: user.id,
            workspaceId: workspace.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          workspaceId: workspace.id,
          role: 'STAFF',
        },
      })

      const team = await prisma.team.create({
        data: {
          name,
          color: color || '#18181B',
          workspaceId: workspace.id,
          members: { create: { userId: user.id, isAttendancePrimary: false } }
        },
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
          projects: { include: { project: { select: { id: true, name: true, color: true, icon: true, status: true } } } }
        }
      })
      logAudit({ action: "create", entityType: "team", entityId: team.id, entityName: name, userId: user.id, request: req })
      return NextResponse.json(team, { status: 201 })
    }

    const existingTeam = await prisma.team.findFirst({
      where: {
        workspaceId: membership.workspaceId,
        name: {
          equals: name.trim(),
          mode: 'insensitive',
        },
      },
      select: { id: true },
    })

    if (existingTeam) {
      return NextResponse.json({ error: 'A team with this name already exists in the workspace' }, { status: 409 })
    }

    const team = await prisma.team.create({
      data: {
        name: name.trim(),
        color: color || '#18181B',
        workspaceId: membership.workspaceId,
        members: { create: { userId: user.id, isAttendancePrimary: false } }
      },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
        projects: { include: { project: { select: { id: true, name: true, color: true, icon: true, status: true } } } }
      }
    })
    logAudit({ action: "create", entityType: "team", entityId: team.id, entityName: name, userId: user.id, request: req })
    return NextResponse.json(team, { status: 201 })
  } catch (error) {
    console.error('Teams POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
