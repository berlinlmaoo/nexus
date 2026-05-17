export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import crypto from 'crypto'
import { logAudit } from '@/lib/audit'

export async function GET(
  _req: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId } = params

    // Check membership
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    })

    if (!member || member.role === 'GUEST') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get pending invites
    const invites = await prisma.inviteToken.findMany({
      where: { projectId, accepted: false, expiresAt: { gt: new Date() } },
      include: {
        inviter: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get current members
    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    })

    return NextResponse.json({ invites, members })
  } catch (error) {
    console.error('Error fetching invites:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId } = params
    const body = await req.json()
    const { email, role = 'GUEST' } = body

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!['GUEST', 'MEMBER', 'VIEWER'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Check inviter's membership and permissions
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    })

    if (!member || member.role === 'GUEST' || member.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'You do not have permission to invite users' },
        { status: 403 }
      )
    }

    // Check if user is already a member
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      const existingMember = await prisma.projectMember.findUnique({
        where: {
          userId_projectId: { userId: existingUser.id, projectId },
        },
      })
      if (existingMember) {
        return NextResponse.json(
          { error: 'User is already a member of this project' },
          { status: 409 }
        )
      }
    }

    // Check for existing pending invite
    const existingInvite = await prisma.inviteToken.findFirst({
      where: {
        email,
        projectId,
        accepted: false,
        expiresAt: { gt: new Date() },
      },
    })

    if (existingInvite) {
      return NextResponse.json(
        { error: 'An invite is already pending for this email' },
        { status: 409 }
      )
    }

    // Generate token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const invite = await prisma.inviteToken.create({
      data: {
        email,
        token,
        role: role as 'GUEST' | 'MEMBER' | 'VIEWER',
        expiresAt,
        projectId,
        inviterId: session.user.id,
      },
    })

    // If user already exists, add them directly
    if (existingUser) {
      await prisma.projectMember.create({
        data: {
          userId: existingUser.id,
          projectId,
          role: role as 'GUEST' | 'MEMBER' | 'VIEWER',
        },
      })
      await prisma.inviteToken.update({
        where: { id: invite.id },
        data: { accepted: true },
      })

      logAudit({ action: "create", entityType: "invite", entityId: invite.id, entityName: email, userId: session.user.id, metadata: { projectId, role, accepted: true } })

      return NextResponse.json(
        { message: 'User added to project', invite, accepted: true },
        { status: 201 }
      )
    }

    // User doesn't exist — create a placeholder account
    const newUser = await prisma.user.create({
      data: {
        name: email.split('@')[0],
        email,
        password: null,
      },
    })

    await prisma.projectMember.create({
      data: {
        userId: newUser.id,
        projectId,
        role: role as 'GUEST' | 'MEMBER' | 'VIEWER',
      },
    })

    logAudit({ action: "create", entityType: "invite", entityId: invite.id, entityName: email, userId: session.user.id, metadata: { projectId, role, newUserCreated: true } })

    return NextResponse.json(
      {
        message: 'Invite created. User account created — they will need to set a password on first login.',
        invite,
        inviteLink: `/invite/${token}`,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating invite:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId } = params
    const { searchParams } = new URL(req.url)
    const inviteId = searchParams.get('inviteId')

    if (!inviteId) {
      return NextResponse.json({ error: 'inviteId is required' }, { status: 400 })
    }

    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    })

    if (!member || member.role === 'GUEST' || member.role === 'VIEWER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const invite = await prisma.inviteToken.findUnique({
      where: { id: inviteId },
    })

    if (!invite || invite.projectId !== projectId) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    await prisma.inviteToken.delete({ where: { id: inviteId } })

    logAudit({ action: "delete", entityType: "invite", entityId: inviteId, entityName: invite.email, userId: session.user.id, metadata: { projectId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting invite:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
