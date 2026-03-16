import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const sprints = await prisma.sprint.findMany({
    where: { projectId },
    include: { tasks: { include: { task: { select: { id: true, title: true, status: true, priority: true, assignees: { include: { user: { select: { id: true, name: true } } } } } } } } },
    orderBy: { startDate: 'desc' },
  })
  return NextResponse.json({ sprints })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, projectId, startDate, endDate } = await req.json()
  if (!name || !projectId || !startDate || !endDate) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const sprint = await prisma.sprint.create({
    data: { name, projectId, startDate: new Date(startDate), endDate: new Date(endDate) },
    include: { tasks: { include: { task: { select: { id: true, title: true, status: true } } } } },
  })
  return NextResponse.json({ sprint }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, status, addTaskId, removeTaskId, name, startDate, endDate } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (addTaskId) await prisma.sprintTask.create({ data: { sprintId: id, taskId: addTaskId } }).catch(() => {})
  if (removeTaskId) await prisma.sprintTask.deleteMany({ where: { sprintId: id, taskId: removeTaskId } })
  const sprint = await prisma.sprint.update({
    where: { id },
    data: { ...(status !== undefined && { status }), ...(name !== undefined && { name }), ...(startDate !== undefined && { startDate: new Date(startDate) }), ...(endDate !== undefined && { endDate: new Date(endDate) }) },
    include: { tasks: { include: { task: { select: { id: true, title: true, status: true, priority: true } } } } },
  })
  return NextResponse.json({ sprint })
}
