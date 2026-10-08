export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { restorableDelete } from '@/lib/deletion-snapshot'
import { checkProjectAccess } from '@/lib/rbac'
import { isAdminOrOrgBodPlus } from '@/lib/org'
import { webhookUrlError } from '@/lib/webhook-dispatcher'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ webhookId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { webhookId } = await params
    const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } })

    if (!webhook || webhook.userId !== session.user.id) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const body = await req.json()
    const { url, events, active, projectId } = body

    const data: Record<string, unknown> = {}
    if (url !== undefined) {
      // https, and not pointing at this server / the LAN / Tailscale (SSRF).
      const urlError = await webhookUrlError(url)
      if (urlError) {
        return NextResponse.json({ error: urlError }, { status: 400 })
      }
      data.url = url
    }
    if (events !== undefined) data.events = events
    if (active !== undefined) data.active = active
    if (projectId !== undefined) {
      // Same rule as creating one: project access for a project webhook, BoD+ for a global one.
      if (projectId) {
        if (typeof projectId !== 'string' || !(await checkProjectAccess(session.user.id, projectId, ['MEMBER'])).allowed) {
          return NextResponse.json({ error: 'Not a member of this project' }, { status: 403 })
        }
      } else if (!(await isAdminOrOrgBodPlus(session.user.id))) {
        return NextResponse.json({ error: 'Only BoD can create a webhook for all projects' }, { status: 403 })
      }
      data.projectId = projectId || null
    }

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
  { params }: { params: Promise<{ webhookId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { webhookId } = await params
    const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } })

    if (!webhook || webhook.userId !== session.user.id) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    // Kept first (secret included: it comes back working), so Control Room → Audit can restore it.
    // Named by its host only: a webhook URL can carry a token in its path or query.
    let host = "webhook"
    try { host = new URL(webhook.url).host || host } catch { /* not a URL */ }
    await restorableDelete({
      entityType: "webhook", entityId: webhookId, entityName: host, workspaceId: null,
      userId: session.user.id, request: _req, metadata: { projectId: webhook.projectId ?? null, events: webhook.events },
      meta: webhook.projectId ? { open: { type: "project", id: webhook.projectId }, projectId: webhook.projectId } : { open: null },
      remove: (tx) => tx.webhook.delete({ where: { id: webhookId } }),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting webhook:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
