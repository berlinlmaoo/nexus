export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

// Integrity (peer reports) and Social Approvals were removed on 12 Oct 2026. Their old notifications stay
// in people's inboxes as plain, read-only items: the link is dropped so no client (web, iOS, Android)
// opens a page that no longer exists.
function isRetiredNotification(n: { type: string | null; link: string | null }): boolean {
  const type = (n.type ?? '').toLowerCase()
  if (type.startsWith('peer_report') || type === 'violation_announcement') return true
  return /^\/(peer-reports|social)(?:[/?#]|$)/.test(n.link ?? '')
}

function withoutRetiredLink<T extends { type: string | null; link: string | null }>(n: T): T {
  return isRetiredNotification(n) ? { ...n, link: null } : n
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const unreadOnly = searchParams.get('unread') === 'true'
    const notifications = await prisma.notification.findMany({
      where: { userId: session.user.id, ...(unreadOnly && { read: false }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const unreadCount = await prisma.notification.count({ where: { userId: session.user.id, read: false } })
    // The sender, for the row's avatar (13 Oct 2026). Additive `actor` (null for system rows and rows
    // written before actorId existed); older clients ignore it.
    const actorIds = [...new Set(notifications.map((n) => n.actorId).filter((x): x is string => !!x))]
    const actors = actorIds.length
      ? new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, avatar: true } })).map((u) => [u.id, u]))
      : new Map<string, { id: string; name: string | null; avatar: string | null }>()
    return NextResponse.json({
      notifications: notifications.map((n) => ({ ...withoutRetiredLink(n), actor: (n.actorId && actors.get(n.actorId)) || null })),
      unreadCount,
    })
  } catch (error) {
    console.error('Error fetching notifications:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id, markAllRead } = await req.json()
    if (markAllRead) {
      await prisma.notification.updateMany({ where: { userId: session.user.id, read: false }, data: { read: true } })
      logAudit({ action: 'update', entityType: 'notification', userId: session.user.id, request: req, metadata: { markAllRead: true } })
      return NextResponse.json({ success: true })
    }
    if (id) {
      // Scoped to the caller: `where: { id }` alone would let anyone mark anyone's row read.
      await prisma.notification.updateMany({ where: { id, userId: session.user.id }, data: { read: true } })
      logAudit({ action: 'update', entityType: 'notification', entityId: id, userId: session.user.id, request: req })
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ error: 'id or markAllRead required' }, { status: 400 })
  } catch (error) {
    console.error('Error updating notifications:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const clearRead = searchParams.get('clearRead')

    if (clearRead === 'true') {
      const result = await prisma.notification.deleteMany({
        where: { userId: session.user.id, read: true },
      })
      logAudit({ action: 'delete', entityType: 'notification', userId: session.user.id, request: req, metadata: { clearRead: true, deleted: result.count } })
      return NextResponse.json({ deleted: result.count })
    }

    const body = await req.json()

    // Batch delete by ids array
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const result = await prisma.notification.deleteMany({
        where: { id: { in: body.ids }, userId: session.user.id },
      })
      logAudit({ action: 'delete', entityType: 'notification', userId: session.user.id, request: req, metadata: { ids: body.ids, deleted: result.count } })
      return NextResponse.json({ deleted: result.count })
    }

    // Single delete by id
    if (body.id) {
      await prisma.notification.delete({ where: { id: body.id, userId: session.user.id } })
      logAudit({ action: 'delete', entityType: 'notification', entityId: body.id, userId: session.user.id, request: req })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'id, ids array, or clearRead param required' }, { status: 400 })
  } catch (error) {
    console.error('Error deleting notifications:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
