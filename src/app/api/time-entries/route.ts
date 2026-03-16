import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const taskId = searchParams.get('taskId')
  const entries = await prisma.timeEntry.findMany({
    where: taskId ? { taskId } : {},
    include: { user: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    orderBy: { startTime: 'desc' },
  })
  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { taskId, startTime, endTime, duration, description } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  const entry = await prisma.timeEntry.create({
    data: { taskId, userId: session.user.id, startTime: new Date(startTime || Date.now()), endTime: endTime ? new Date(endTime) : null, duration: duration || null, description: description || null },
    include: { user: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
  })
  return NextResponse.json({ entry }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, endTime, duration, description } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const entry = await prisma.timeEntry.update({
    where: { id },
    data: { ...(endTime !== undefined && { endTime: new Date(endTime) }), ...(duration !== undefined && { duration }), ...(description !== undefined && { description }) },
  })
  return NextResponse.json({ entry })
}
