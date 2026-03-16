import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
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
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, markAllRead } = await req.json()
  if (markAllRead) {
    await prisma.notification.updateMany({ where: { userId: session.user.id, read: false }, data: { read: true } })
    return NextResponse.json({ success: true })
  }
  if (id) {
    await prisma.notification.update({ where: { id }, data: { read: true } })
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: 'id or markAllRead required' }, { status: 400 })
}
