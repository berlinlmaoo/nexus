import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

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
    return NextResponse.json({ notifications, unreadCount })
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
      await prisma.notification.update({ where: { id }, data: { read: true } })
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
