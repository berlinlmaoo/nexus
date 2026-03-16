import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const goal = await prisma.goal.findUnique({
    where: { id: params.goalId },
    include: { owner: { select: { id: true, name: true, avatar: true } }, milestones: { orderBy: { dueDate: 'asc' } } },
  })
  if (!goal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ goal })
}

export async function PATCH(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()

  if (body.addMilestone) {
    await prisma.goalMilestone.create({ data: { goalId: params.goalId, title: body.addMilestone.title, dueDate: body.addMilestone.dueDate ? new Date(body.addMilestone.dueDate) : null } })
  }
  if (body.toggleMilestone) {
    await prisma.goalMilestone.update({ where: { id: body.toggleMilestone.id }, data: { completed: body.toggleMilestone.completed } })
    const milestones = await prisma.goalMilestone.findMany({ where: { goalId: params.goalId } })
    const completed = milestones.filter(m => m.completed).length
    const progress = milestones.length > 0 ? Math.round((completed / milestones.length) * 100) : 0
    await prisma.goal.update({ where: { id: params.goalId }, data: { progress } })
  }

  const { title, description, status, progress, dueDate } = body
  if (title !== undefined || description !== undefined || status !== undefined || progress !== undefined || dueDate !== undefined) {
    await prisma.goal.update({
      where: { id: params.goalId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(progress !== undefined && { progress }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      },
    })
  }

  const goal = await prisma.goal.findUnique({
    where: { id: params.goalId },
    include: { owner: { select: { id: true, name: true, avatar: true } }, milestones: { orderBy: { dueDate: 'asc' } } },
  })
  return NextResponse.json({ goal })
}

export async function DELETE(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.goal.delete({ where: { id: params.goalId } })
  return NextResponse.json({ success: true })
}
