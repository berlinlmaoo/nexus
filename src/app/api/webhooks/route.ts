import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const webhooks = await prisma.webhook.findMany({
    where: { userId: session.user.id },
    include: {
      project: { select: { id: true, name: true } },
      deliveries: {
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          event: true,
          statusCode: true,
          success: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(webhooks)
}

const VALID_EVENTS = [
  'task.created',
  'task.updated',
  'task.completed',
  'comment.created',
  'project.updated',
]

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { url, events, projectId } = body

  if (!url || !events?.length) {
    return NextResponse.json(
      { error: 'url and events[] are required' },
      { status: 400 }
    )
  }

  // Validate URL
  try {
    new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // Validate events
  const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e))
  if (invalidEvents.length > 0) {
    return NextResponse.json(
      { error: `Invalid events: ${invalidEvents.join(', ')}. Valid: ${VALID_EVENTS.join(', ')}` },
      { status: 400 }
    )
  }

  // Verify project membership if projectId provided
  if (projectId) {
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    })
    if (!member) {
      return NextResponse.json(
        { error: 'Not a member of this project' },
        { status: 403 }
      )
    }
  }

  const webhook = await prisma.webhook.create({
    data: {
      url,
      events,
      projectId: projectId || null,
      userId: session.user.id,
    },
    include: {
      project: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(webhook, { status: 201 })
}
