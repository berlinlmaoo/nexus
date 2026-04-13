import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { syncTeamProjectAccess, syncTeamMemberAccess, revokeTeamProjectAccess, revokeTeamMemberAccess } from '@/lib/team-sync'
import { logAudit } from '@/lib/audit'
import { getPrimaryWorkspaceDefaults } from '@/lib/workspace-defaults'
import { isPrimaryTeamName, isPrimaryWorkspace } from '@/lib/primary-team'
import { isSystemAdminUser } from '@/lib/rbac'

async function getTeamContext(teamId: string, actorId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
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
    select: { role: true },
  })

  const isSystemAdmin = await isSystemAdminUser(actorId)
  const canManage = Boolean(
    isSystemAdmin ||
      (workspaceMembership &&
        (workspaceMembership.role === 'OWNER' ||
          workspaceMembership.role === 'ADMIN'))
  )

  return { team, workspaceMembership, canManage, isSystemAdmin }
}

function normalizeTeamName(name: string) {
  return name.trim().toLowerCase()
}

export async function GET() {
  try {
    const session = await auth()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const isSystemAdmin = await isSystemAdminUser(user.id)

    const workspaceMemberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { workspaceId: true, role: true },
    })

    const adminWorkspaceIds = workspaceMemberships
      .filter((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN')
      .map((membership) => membership.workspaceId)

    const memberWorkspaceIds = workspaceMemberships
      .filter((membership) => membership.role === 'MEMBER')
      .map((membership) => membership.workspaceId)

    const teamScopes: any[] = []
    if (isSystemAdmin) {
      teamScopes.push({})
    }
    if (adminWorkspaceIds.length > 0) {
      teamScopes.push({ workspaceId: { in: adminWorkspaceIds } })
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
            role: 'MEMBER',
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
      const { teamId, userId, userIds } = body
      const requestedUserIds = Array.from(
        new Set(
          (Array.isArray(userIds) ? userIds : userId ? [userId] : []).filter(
            (value): value is string => typeof value === 'string' && value.length > 0
          )
        )
      )

      if (!teamId || requestedUserIds.length === 0) {
        console.warn('Teams POST add-member validation failed', { teamId, memberId: userId, memberIds: userIds, actorId: user.id })
        return NextResponse.json({ error: 'teamId and at least one userId are required' }, { status: 400 })
      }

      const { team, canManage } = await getTeamContext(teamId, user.id)
      if (!team || !canManage) {
        console.warn('Teams POST add-member forbidden', { teamId, memberIds: requestedUserIds, actorId: user.id })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const targetUsers = await prisma.user.findMany({
        where: { id: { in: requestedUserIds } },
        select: { id: true, name: true, email: true, avatar: true },
      })

      if (targetUsers.length !== requestedUserIds.length) {
        console.warn('Teams POST add-member user missing', { teamId, memberIds: requestedUserIds, actorId: user.id })
        return NextResponse.json({ error: 'One or more users were not found' }, { status: 404 })
      }

      await prisma.workspaceMember.createMany({
        data: requestedUserIds.map((memberId) => ({
          userId: memberId,
          workspaceId: team.workspaceId,
          role: 'MEMBER',
        })),
        skipDuplicates: true,
      })

      await prisma.teamMember.createMany({
        data: requestedUserIds.map((memberId) => ({
          teamId,
          userId: memberId,
        })),
        skipDuplicates: true,
      })

      for (const memberId of requestedUserIds) {
        await syncTeamMemberAccess(teamId, memberId)
        logAudit({
          action: "create",
          entityType: "team_member",
          entityId: teamId,
          entityName: `${teamId}:${memberId}`,
          userId: user.id,
          request: req,
          metadata: { teamId, memberId },
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

    // Default: create team
    const { name, color } = body
    if (!name) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
    const isSystemAdmin = await isSystemAdminUser(user.id)

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id }
    })

    if (!isSystemAdmin && (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN'))) {
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
          role: 'MEMBER',
        },
      })

      const team = await prisma.team.create({
        data: {
          name,
          color: color || '#18181B',
          workspaceId: workspace.id,
          members: { create: { userId: user.id } }
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
        members: { create: { userId: user.id } }
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
