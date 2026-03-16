import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: { taskId: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dependencies = await prisma.taskDependency.findMany({
    where: { taskId: params.taskId },
    include: { dependsOnTask: { select: { id: true, title: true, status: true } } },
  })
  const dependedOnBy = await prisma.taskDependency.findMany({
    where: { dependsOnTaskId: params.taskId },
    include: { task: { select: { id: true, title: true, status: true } } },
  })
  return NextResponse.json({ dependencies, dependedOnBy })
}

export async function POST(req: NextRequest, { params }: { params: { taskId: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { dependsOnTaskId, type } = await req.json()
  if (!dependsOnTaskId) return NextResponse.json({ error: 'dependsOnTaskId required' }, { status: 400 })
  const dep = await prisma.taskDependency.create({
    data: { taskId: params.taskId, dependsOnTaskId, type: type || 'BLOCKING' },
    include: { dependsOnTask: { select: { id: true, title: true, status: true } } },
  })
  return NextResponse.json({ dependency: dep }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await prisma.taskDependency.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
