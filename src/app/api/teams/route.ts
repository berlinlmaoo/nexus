import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'

export async function GET() {
  try {
    const session = await auth()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const teams = await prisma.team.findMany({
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } }
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

    const { name, color } = await req.json()

    if (!name) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })

    // Get first workspace
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id }
    })

    if (!membership) {
      // Create default workspace if none exists
      const workspace = await prisma.workspace.create({
        data: {
          name: 'PATS Group',
          slug: 'pats-group',
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
          members: { include: { user: { select: { id: true, name: true, email: true } } } }
        }
      })
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
        members: { include: { user: { select: { id: true, name: true, email: true } } } }
      }
    })
    return NextResponse.json(team, { status: 201 })
  } catch (error) {
    console.error('Teams POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
