import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const automations = await prisma.automation.findMany({ where: { projectId }, orderBy: { name: 'asc' } })
  return NextResponse.json({ automations })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, projectId, trigger, action } = await req.json()
  if (!name || !projectId || !trigger || !action) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const automation = await prisma.automation.create({ data: { name, projectId, trigger, action } })
  return NextResponse.json({ automation }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, enabled, name, trigger, action } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const automation = await prisma.automation.update({
    where: { id },
    data: { ...(enabled !== undefined && { enabled }), ...(name !== undefined && { name }), ...(trigger !== undefined && { trigger }), ...(action !== undefined && { action }) },
  })
  return NextResponse.json({ automation })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await prisma.automation.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
