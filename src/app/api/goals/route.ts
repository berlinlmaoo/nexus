import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const goals = await prisma.goal.findMany({
    include: { owner: { select: { id: true, name: true, avatar: true } }, milestones: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ goals })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { title, description, dueDate, workspaceId } = await req.json()
  if (!title || !workspaceId) return NextResponse.json({ error: 'Title and workspaceId required' }, { status: 400 })
  const goal = await prisma.goal.create({
    data: { title, description: description || null, dueDate: dueDate ? new Date(dueDate) : null, workspaceId, ownerId: session.user.id },
    include: { owner: { select: { id: true, name: true, avatar: true } }, milestones: true },
  })
  return NextResponse.json({ goal }, { status: 201 })
}
