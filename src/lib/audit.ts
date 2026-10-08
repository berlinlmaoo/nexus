import prisma from '@/lib/prisma'
import type { InputJsonValue } from '@prisma/client/runtime/client'
import { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logger'
import { redactAuditMetadata } from '@/lib/audit-describe'
import { emitAuditChanged } from '@/lib/socket-emitter'

const log = createLogger('audit')

interface AuditLogParams {
  action: string
  entityType: string
  entityId?: string
  entityName?: string
  userId: string
  metadata?: Record<string, unknown>
  request?: NextRequest | Request
}

export async function logAudit({
  action,
  entityType,
  entityId,
  entityName,
  userId,
  metadata,
  request,
}: AuditLogParams): Promise<string | null> {
  try {
    let ipAddress: string | undefined
    let userAgent: string | undefined

    if (request) {
      const headers = request.headers
      ipAddress =
        headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        headers.get('x-real-ip') ||
        undefined
      userAgent = headers.get('user-agent') || undefined
    }

    const row = await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        entityName,
        userId,
        // Secret-looking keys (password, token, secret, apiKey…) are blanked before the write: a few
        // call sites log a raw request body (`changes: body`), and a body can carry one.
        metadata: (metadata ? redactAuditMetadata(metadata) : undefined) as InputJsonValue | undefined,
        ipAddress,
        userAgent,
      },
      select: { id: true },
    })
    // Every open Control Room → Audit refetches (a ping, no data; lib/socket-emitter.ts).
    emitAuditChanged()
    // The id ties a restorable delete (lib/deletion-snapshot.ts) to its row.
    return row.id
  } catch (error) {
    log.error('Audit log write failed', { error: String(error) })
    return null
  }
}

interface BatchAuditEntry {
  action: string
  entityType: string
  entityId?: string
  entityName?: string
  metadata?: Record<string, unknown>
}

export async function logAuditBatch(
  entries: BatchAuditEntry[],
  userId: string,
  request?: NextRequest | Request
) {
  try {
    let ipAddress: string | undefined
    let userAgent: string | undefined

    if (request) {
      const headers = request.headers
      ipAddress =
        headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        headers.get('x-real-ip') ||
        undefined
      userAgent = headers.get('user-agent') || undefined
    }

    await prisma.auditLog.createMany({
      data: entries.map((entry) => ({
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityName: entry.entityName,
        userId,
        metadata: (entry.metadata ? redactAuditMetadata(entry.metadata) : undefined) as InputJsonValue | undefined,
        ipAddress,
        userAgent,
      })),
    })
    if (entries.length > 0) emitAuditChanged()
  } catch (error) {
    log.error('Batch audit log write failed', { error: String(error) })
  }
}
