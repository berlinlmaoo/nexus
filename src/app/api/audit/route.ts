export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { resolveAuditAccess } from '@/lib/audit-query'
import { auditSummary } from '@/lib/audit-describe'
import { restoreInfoFor } from '@/lib/deletion-snapshot'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorize: admin-tier role, visibility scoped to actors in the caller's admin workspaces. The
    // rule lives in lib/audit-query so GET /api/audit/[id] applies exactly the same one.
    const access = await resolveAuditAccess(session.user.id)
    if (!access.ok) {
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

    // Scope to actors inside the caller's admin workspaces unless they're an all-seeing super-admin.
    const where: Prisma.AuditLogWhereInput = { ...access.scope }

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

    // `restore`: on a delete that kept a copy (lib/deletion-snapshot.ts), null otherwise. One query.
    const restore = await restoreInfoFor(logs.filter((row) => row.action === 'delete').map((row) => row.id))

    // `summary`: one English sentence per row, from the row alone (no per-row query). Additive — the
    // rest of each row is unchanged. GET /api/audit/[id] has the full explanation.
    return NextResponse.json({
      logs: logs.map((row) => ({ ...row, summary: auditSummary(row), restore: restore.get(row.id) ?? null })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Audit log API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
