import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const goals = await prisma.goal.findMany({
      where: {
        // Workspace isolation: only return goals from workspaces the user is a member of
        workspace: {
          members: {
            some: { userId: session.user.id },
          },
        },
      },
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
        milestones: true,
        children: {
          include: {
            owner: { select: { id: true, name: true, avatar: true } },
            milestones: true,
            children: {
              include: {
                owner: { select: { id: true, name: true, avatar: true } },
                milestones: true,
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ goals })
  } catch (error) {
    console.error('Error fetching goals:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { title, description, dueDate, workspaceId, parentId } = await req.json()
    if (!title || !workspaceId) return NextResponse.json({ error: 'Title and workspaceId required' }, { status: 400 })
    const goal = await prisma.goal.create({
      data: { title, description: description || null, dueDate: dueDate ? new Date(dueDate) : null, workspaceId, ownerId: session.user.id, parentId: parentId || null },
      include: { owner: { select: { id: true, name: true, avatar: true } }, milestones: true },
    })
    logAudit({ action: 'create', entityType: 'goal', entityId: goal.id, entityName: title, userId: session.user.id, request: req })
    return NextResponse.json({ goal }, { status: 201 })
  } catch (error) {
    console.error('Error creating goal:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
