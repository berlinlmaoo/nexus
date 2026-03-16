import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { executeAutomations } from '@/lib/automation-engine'

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
  const existingSprint = await prisma.sprint.findUnique({ where: { id }, select: { status: true, projectId: true } })
  const sprint = await prisma.sprint.update({
    where: { id },
    data: { ...(status !== undefined && { status }), ...(name !== undefined && { name }), ...(startDate !== undefined && { startDate: new Date(startDate) }), ...(endDate !== undefined && { endDate: new Date(endDate) }) },
    include: { tasks: { include: { task: { select: { id: true, title: true, status: true, priority: true } } } } },
  })

  // Fire automations when sprint becomes ACTIVE
  if (status === 'ACTIVE' && existingSprint && existingSprint.status !== 'ACTIVE') {
    executeAutomations(sprint.projectId, 'sprint_started', {
      userId: session.user.id!,
      projectId: sprint.projectId,
      sprintId: sprint.id,
    }).catch(() => {})
  }

  return NextResponse.json({ sprint })
}
