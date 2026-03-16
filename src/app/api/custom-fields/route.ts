import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const fields = await prisma.customField.findMany({ where: { projectId }, include: { values: true } })
  return NextResponse.json({ fields })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, type, projectId, options } = await req.json()
  if (!name || !type || !projectId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const field = await prisma.customField.create({ data: { name, type, projectId, options: options || null } })
  return NextResponse.json({ field }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, taskId, value } = await req.json()
  if (!id || !taskId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const fieldValue = await prisma.customFieldValue.upsert({
    where: { customFieldId_taskId: { customFieldId: id, taskId } },
    update: { value: String(value) },
    create: { customFieldId: id, taskId, value: String(value) },
  })
  return NextResponse.json({ fieldValue })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await prisma.customField.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
