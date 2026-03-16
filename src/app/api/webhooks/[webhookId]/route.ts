import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(
  req: Request,
  { params }: { params: { webhookId: string } }
) {
  try {
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

    logAudit({ action: "update", entityType: "webhook", entityId: webhookId, userId: session.user.id, request: req, metadata: { changes: body } })

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating webhook:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { webhookId: string } }
) {
  try {
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

    logAudit({ action: "delete", entityType: "webhook", entityId: webhookId, userId: session.user.id, request: _req })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting webhook:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
