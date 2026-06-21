export const dynamic = "force-dynamic"

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

    // Authorize: caller must hold an admin-tier role. Resolve memberships deterministically (the old
    // findFirst picked an arbitrary membership, so a STAFF-in-A / BOD-in-B user got an unpredictable
    // verdict). Collect every workspace where they're BOD/MANAGER/ONE_ABOVE_ALL — audit visibility is
    // then scoped to actors in exactly those workspaces (no cross-tenant audit-log leak).
    const [memberships, user] = await Promise.all([
      prisma.workspaceMember.findMany({
        where: { userId: session.user.id },
        select: { workspaceId: true, role: true },
      }),
      prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } }),
    ])

    const isGlobalAdmin = user?.role === 'ADMIN'
    const isAllSeeing = isGlobalAdmin || memberships.some((m) => m.role === 'ONE_ABOVE_ALL')
    const adminWorkspaceIds = memberships
      .filter((m) => m.role === 'BOD' || m.role === 'MANAGER' || m.role === 'ONE_ABOVE_ALL')
      .map((m) => m.workspaceId)

    if (!isAllSeeing && adminWorkspaceIds.length === 0) {
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

    // Scope to actors inside the caller's admin workspaces unless they're an all-seeing super-admin.
    if (!isAllSeeing) {
      where.user = { workspaceMembers: { some: { workspaceId: { in: adminWorkspaceIds } } } }
    }

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
