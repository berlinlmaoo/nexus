import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function PATCH(
  req: Request,
  { params }: { params: { webhookId: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { webhookId } = params
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } })

  if (!webhook || webhook.userId !== session.user.id) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  const body = await req.json()
  const { url, events, active, projectId } = body

  const data: Record<string, unknown> = {}
  if (url !== undefined) {
    try {
      new URL(url)
      data.url = url
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }
  }
  if (events !== undefined) data.events = events
  if (active !== undefined) data.active = active
  if (projectId !== undefined) data.projectId = projectId || null

  const updated = await prisma.webhook.update({
    where: { id: webhookId },
    data,
    include: {
      project: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: Request,
  { params }: { params: { webhookId: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { webhookId } = params
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } })

  if (!webhook || webhook.userId !== session.user.id) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  await prisma.webhook.delete({ where: { id: webhookId } })

  return NextResponse.json({ success: true })
}
