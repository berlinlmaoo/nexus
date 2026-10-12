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


/**
 * A "view" (someone opened a report or a member record) is logged once per viewer, thing and WIB day, not on
 * every open: 10 identical rows in 6 minutes buried the audit log (QA BoD R2 B29). The first view of the day
 * still says who looked at whose data.
 */
export async function logViewOncePerDay(params: AuditLogParams): Promise<string | null> {
  try {
    const now = new Date()
    const wib = new Date(now.getTime() + 7 * 3600_000)
    const dayStart = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - 7 * 3600_000)
    const seen = await prisma.auditLog.findFirst({
      where: { userId: params.userId, action: "view", entityType: params.entityType, entityId: params.entityId, createdAt: { gte: dayStart } },
      select: { id: true },
    })
    if (seen) return null
  } catch {
    // On a lookup failure, log as before.
  }
  return logAudit({ ...params, action: "view" })
}
