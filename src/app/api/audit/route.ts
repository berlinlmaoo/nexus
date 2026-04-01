import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is owner or admin
    const member = await prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
    })

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })

    if (user?.role !== 'ADMIN' && member?.role !== 'OWNER' && member?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get('userId')
    const entityType = searchParams.get('entityType')
    const action = searchParams.get('action')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const where: Prisma.AuditLogWhereInput = {}

    if (userId) where.userId = userId
    if (entityType) where.entityType = entityType
    if (action) where.action = action
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to)
    }
    if (search) {
      where.OR = [
        { entityName: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: where as any,
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
      }),
      prisma.auditLog.count({ where: where as any }),
    ])

    return NextResponse.json({ logs, total, limit, offset })
  } catch (error) {
    console.error('Audit log API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
