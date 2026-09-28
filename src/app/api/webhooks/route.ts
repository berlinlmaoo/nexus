export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { checkProjectAccess } from '@/lib/rbac'
import { isAdminOrOrgBodPlus } from '@/lib/org'
import { webhookUrlError } from '@/lib/webhook-dispatcher'

export async function GET() {
  try {
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
  } catch (error) {
    console.error("Error fetching webhooks:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

const VALID_EVENTS = [
  'task.created',
  'task.updated',
  'task.completed',
  'comment.created',
  'project.updated',
]

export async function POST(req: Request) {
  try {
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

    // Validate URL: https, and not pointing at this server / the LAN / Tailscale (SSRF).
    const urlError = await webhookUrlError(url)
    if (urlError) {
      return NextResponse.json({ error: urlError }, { status: 400 })
    }

    // Validate events
    const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e))
    if (invalidEvents.length > 0) {
      return NextResponse.json(
        { error: `Invalid events: ${invalidEvents.join(', ')}. Valid: ${VALID_EVENTS.join(', ')}` },
        { status: 400 }
      )
    }

    // A project webhook needs access to that project. A global one (no project) hears about every
    // project in the system: system admin or company BoD+ only.
    if (projectId) {
      if (typeof projectId !== 'string' || !(await checkProjectAccess(session.user.id, projectId, ['MEMBER'])).allowed) {
        return NextResponse.json(
          { error: 'Not a member of this project' },
          { status: 403 }
        )
      }
    } else if (!(await isAdminOrOrgBodPlus(session.user.id))) {
      return NextResponse.json(
        { error: 'Only BoD can create a webhook for all projects' },
        { status: 403 }
      )
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

    logAudit({ action: "create", entityType: "webhook", entityId: webhook.id, userId: session.user.id, request: req, metadata: { url, events } })

    return NextResponse.json(webhook, { status: 201 })
  } catch (error) {
    console.error("Error creating webhook:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
