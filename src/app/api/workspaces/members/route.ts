export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'
import { isSystemAdminUser } from '@/lib/rbac'

async function canManageTeamInWorkspace(userId: string, workspaceId: string, teamId?: string) {
  if (!teamId) return false

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      workspaceId: true,
      members: {
        where: { userId },
        select: { id: true },
      },
    },
  })

  return Boolean(team && team.workspaceId === workspaceId && team.members.length > 0)
}

async function getWorkspaceAndRole(userId: string, workspaceId?: string) {
  const member = await prisma.workspaceMember.findFirst({
    where: {
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  })
  return member
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requestedWorkspaceId = req.nextUrl.searchParams.get('workspaceId') || undefined
    const includeRegistered = req.nextUrl.searchParams.get('includeRegistered') === '1'
    const teamId = req.nextUrl.searchParams.get('teamId') || undefined

    const member = await getWorkspaceAndRole(session.user.id, requestedWorkspaceId)
    if (!member) return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: member.workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { joinedAt: 'asc' },
    })

    const payload: {
      workspaceId: string
      role: string
      members: Array<{
        id: string
        userId: string
        name: string
        email: string
        avatar: string | null
        role: string
        attendanceRole: string
        joinedAt: Date
      }>
      availableUsers?: Array<{
        id: string
        name: string
        email: string
        avatar: string | null
      }>
    } = {
      workspaceId: member.workspaceId,
      role: member.role,
      members: members.map(m => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatar: m.user.avatar,
        role: m.role,
        attendanceRole: m.attendanceRole,
        joinedAt: m.joinedAt,
      })),
    }

    const canSeeRegistered =
      isSystemAdmin ||
      member.role === 'OWNER' ||
      member.role === 'ADMIN' ||
      await canManageTeamInWorkspace(session.user.id, member.workspaceId, teamId)

    if (includeRegistered && canSeeRegistered) {
      const availableUsers = await prisma.user.findMany({
        where: {
          NOT: {
            workspaceMembers: {
              some: { workspaceId: member.workspaceId },
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      payload.availableUsers = availableUsers
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error("Error fetching workspace members:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { email, role = 'MEMBER', attendanceRole = 'NONE', workspaceId } = await req.json()

    const currentMember = await getWorkspaceAndRole(session.user.id, workspaceId)
    if (!currentMember) return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)
    if (!isSystemAdmin && currentMember.role !== 'OWNER' && currentMember.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only owners and admins can invite members' }, { status: 403 })
    }

    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

    // Check if user already exists
    let user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
      // Create placeholder user
      const hashedPassword = await bcrypt.hash(Math.random().toString(36).slice(2) + 'Aa1!', 12)
      user = await prisma.user.create({
        data: {
          email,
          name: email.split('@')[0],
          password: hashedPassword,
        },
      })
    }

    // Check if already a member
    const existing = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: currentMember.workspaceId } },
    })
    if (existing) {
      return NextResponse.json({ error: 'User is already a workspace member' }, { status: 409 })
    }

    const newMember = await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: currentMember.workspaceId,
        role,
        attendanceRole,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    })

    logAudit({ action: "create", entityType: "workspace_member", entityId: newMember.id, entityName: email, userId: session.user.id, request: req, metadata: { role, attendanceRole, workspaceId: currentMember.workspaceId } })

    return NextResponse.json({
      member: {
        id: newMember.id,
        userId: newMember.user.id,
        name: newMember.user.name,
        email: newMember.user.email,
        avatar: newMember.user.avatar,
        role: newMember.role,
        attendanceRole: newMember.attendanceRole,
        joinedAt: newMember.joinedAt,
      },
    }, { status: 201 })
  } catch (error) {
    console.error("Error inviting workspace member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { memberId, role, attendanceRole, workspaceId } = await req.json()

    const currentMember = await getWorkspaceAndRole(session.user.id, workspaceId)
    if (!currentMember) return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)
    if (!isSystemAdmin && currentMember.role !== 'OWNER' && currentMember.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only owners and admins can change roles' }, { status: 403 })
    }

    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    if (role !== undefined && !['OWNER', 'ADMIN', 'MEMBER'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (attendanceRole !== undefined && !['NONE', 'SUPERVISOR'].includes(attendanceRole)) {
      return NextResponse.json({ error: 'Invalid attendance role' }, { status: 400 })
    }

    // Prevent non-owners from assigning OWNER role
    if (role === 'OWNER' && currentMember.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only owners can assign the owner role' }, { status: 403 })
    }

    const targetMember = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
    })

    if (!targetMember || targetMember.workspaceId !== currentMember.workspaceId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        ...(role !== undefined ? { role } : {}),
        ...(attendanceRole !== undefined ? { attendanceRole } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    })

    logAudit({ action: "update", entityType: "workspace_member", entityId: memberId, userId: session.user.id, request: req, metadata: { newRole: role, attendanceRole } })

    return NextResponse.json({
      member: {
        id: updated.id,
        userId: updated.user.id,
        name: updated.user.name,
        email: updated.user.email,
        avatar: updated.user.avatar,
        role: updated.role,
        attendanceRole: updated.attendanceRole,
        joinedAt: updated.joinedAt,
      },
    })
  } catch (error) {
    console.error("Error updating workspace member role:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requestedWorkspaceId = req.nextUrl.searchParams.get('workspaceId') || undefined
    const currentMember = await getWorkspaceAndRole(session.user.id, requestedWorkspaceId)
    if (!currentMember) return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)
    if (!isSystemAdmin && currentMember.role !== 'OWNER' && currentMember.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only owners and admins can remove members' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const memberId = searchParams.get('memberId')
    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })

    // Prevent removing yourself
    const targetMember = await prisma.workspaceMember.findUnique({ where: { id: memberId } })
    if (!targetMember || targetMember.workspaceId !== currentMember.workspaceId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (targetMember.userId === session.user.id) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
    }
    // Prevent non-owners from removing owners
    if (targetMember.role === 'OWNER' && currentMember.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only owners can remove other owners' }, { status: 403 })
    }

    await prisma.workspaceMember.delete({ where: { id: memberId } })

    logAudit({ action: "delete", entityType: "workspace_member", entityId: memberId, userId: session.user.id, request: req })

    return NextResponse.json({ message: 'Member removed' })
  } catch (error) {
    console.error("Error removing workspace member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
