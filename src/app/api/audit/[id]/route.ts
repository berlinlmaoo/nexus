export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { resolveAuditAccess, resolveAuditNames } from '@/lib/audit-query'
import { collectAuditIds, describeAuditEntry, redactAuditMetadata } from '@/lib/audit-describe'
import { restoreDetailFor } from '@/lib/deletion-snapshot'

/**
 * One audit entry, explained: the raw row (`entry`), one English sentence (`title`), the field
 * changes normalised from every metadata shape the table holds (`changes`), and every other metadata
 * key with ids resolved to names (`details`). Same authorisation as GET /api/audit — a row outside
 * the caller's scope is a 404, not a 403, so ids cannot be probed.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await resolveAuditAccess(session.user.id)
    if (!access.ok) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    if (!id || id.length > 64) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const row = await prisma.auditLog.findFirst({
      where: { AND: [{ id }, access.scope] },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    })
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Rows written before redaction existed may still hold a secret; never send it back.
    const metadata = redactAuditMetadata(row.metadata ?? null)
    const names = await resolveAuditNames(collectAuditIds({ ...row, metadata }))
    const { title, changes, details } = describeAuditEntry({ ...row, metadata }, names)

    return NextResponse.json({
      entry: {
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId ?? null,
        entityName: row.entityName ?? null,
        createdAt: row.createdAt.toISOString(),
        ipAddress: row.ipAddress ?? null,
        userAgent: row.userAgent ?? null,
        user: row.user
          ? { id: row.user.id, name: row.user.name, email: row.user.email ?? null, avatar: row.user.avatar ?? null }
          : null,
        metadata: metadata as unknown,
      },
      title,
      changes,
      details,
      // An entry that kept a copy (a delete, or a revoke): what comes back and whether it already did.
      // POST …/restore does it.
      restore: row.action !== 'restore' ? await restoreDetailFor(row.id) : null,
    })
  } catch (error) {
    console.error('Audit entry API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
