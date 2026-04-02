import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { syncTeamProjectAccess, syncTeamMemberAccess, revokeTeamProjectAccess, revokeTeamMemberAccess } from '@/lib/team-sync'
import { logAudit } from '@/lib/audit'
import { buildPersonalWorkspace } from '@/lib/workspace-defaults'

export async function GET() {
  try {
    const session = await auth()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    const teams = await prisma.team.findMany({
      where: teamScopes.length === 1 ? teamScopes[0] : { OR: teamScopes },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } }
          }
        },
        projects: {
          include: {
            project: { select: { id: true, name: true, color: true, icon: true, status: true } }
          }
        }
      },
      orderBy: { name: 'asc' }
    })
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
        return NextResponse.json({ error: 'teamId and projectId are required' }, { status: 400 })
      }
      const link = await prisma.teamProject.create({
        data: { teamId, projectId },
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
        return NextResponse.json({ error: 'teamId and projectId are required' }, { status: 400 })
      }
      // Revoke team-propagated access before unlinking
      await revokeTeamProjectAccess(teamId, projectId)
      await prisma.teamProject.deleteMany({ where: { teamId, projectId } })
      logAudit({ action: "delete", entityType: "team_project_link", entityId: teamId, entityName: `${teamId}:${projectId}`, userId: user.id, request: req, metadata: { teamId, projectId } })
      return NextResponse.json({ unlinked: true })
    }

    // Handle add/remove member actions
    if (body.action === 'add-member') {
      const { teamId, userId } = body
      if (!teamId || !userId) {
        return NextResponse.json({ error: 'teamId and userId are required' }, { status: 400 })
      }
      const member = await prisma.teamMember.create({
        data: { teamId, userId },
        include: { user: { select: { id: true, name: true, email: true, avatar: true } } }
      })
      // Propagate: grant new member access to all team-linked projects
      await syncTeamMemberAccess(teamId, userId)
      logAudit({ action: "create", entityType: "team_member", entityId: member.id ?? teamId, entityName: `${teamId}:${userId}`, userId: user.id, request: req, metadata: { teamId, memberId: userId } })
      return NextResponse.json(member, { status: 201 })
    }

    if (body.action === 'remove-member') {
      const { teamId, userId } = body
      if (!teamId || !userId) {
        return NextResponse.json({ error: 'teamId and userId are required' }, { status: 400 })
      }
      // Revoke team-propagated project access before removing member
      await revokeTeamMemberAccess(teamId, userId)
      await prisma.teamMember.deleteMany({ where: { teamId, userId } })
      logAudit({ action: "delete", entityType: "team_member", entityId: teamId, entityName: `${teamId}:${userId}`, userId: user.id, request: req, metadata: { teamId, memberId: userId } })
      return NextResponse.json({ removed: true })
    }

    // Default: create team
    const { name, color } = body
    if (!name) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id }
    })

    if (!membership) {
      const personalWorkspace = buildPersonalWorkspace({
        id: user.id,
        name: user.name,
        email: user.email || `${user.id}@nexus.local`,
      })

      const workspace = await prisma.workspace.create({
        data: {
          ...personalWorkspace,
          members: { create: { userId: user.id, role: 'OWNER' } }
        }
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

    const team = await prisma.team.create({
      data: {
        name,
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
