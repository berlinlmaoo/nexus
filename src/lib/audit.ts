import prisma from '@/lib/prisma'
import { NextRequest } from 'next/server'

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
}: AuditLogParams) {
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

    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        entityName,
        userId,
        metadata: metadata ?? undefined,
        ipAddress,
        userAgent,
      },
    })
  } catch (error) {
    console.error('Audit log error:', error)
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
        metadata: entry.metadata ?? undefined,
        ipAddress,
        userAgent,
      })),
    })
  } catch (error) {
    console.error('Batch audit log error:', error)
  }
}
