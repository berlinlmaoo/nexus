import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import {
  captureDeletion,
  readSchema,
  restoreSnapshot,
  snapshotCounts,
  type Db,
  type DbSchema,
  type RestoreResult,
  type SnapshotData,
} from "@/lib/deletion-snapshot-core"

/**
 * Restorable deletes (owner, 8 Oct 2026: Control Room → Audit → Restore). How rows are collected and
 * written back lives in deletion-snapshot-core.ts; this is the Prisma side — the transaction, the
 * DeletionSnapshot row, and the claim that lets a delete be restored once.
 */

export type DeletableEntity = "project" | "task"

const ROOT_TABLE: Record<DeletableEntity, string> = { project: "Project", task: "Task" }

/** Copies are kept this long, restored or not (cron/purge-sheet-revisions). */
export const SNAPSHOT_RETENTION_DAYS = 90

// A big project is a few thousand rows each way; the default 5 s interactive limit is not enough.
const TX = { timeout: 120_000, maxWait: 15_000 }

let cached: { at: number; schema: DbSchema } | null = null

async function schemaOf(db: Db): Promise<DbSchema> {
  // Foreign keys only change with a deploy, which is a new process; ten minutes is a safety net.
  if (!cached || Date.now() - cached.at > 10 * 60_000) cached = { at: Date.now(), schema: await readSchema(db) }
  return cached.schema
}

function dbOf(tx: Prisma.TransactionClient): Db {
  return {
    query: <T,>(sql: string, params: unknown[] = []) => tx.$queryRawUnsafe<T[]>(sql, ...params),
  }
}

/**
 * Deletes a project or a task exactly as the routes always have, after keeping every row the delete
 * takes with it. One transaction: no copy, no delete.
 */
export async function deleteKeepingSnapshot(input: {
  entityType: DeletableEntity
  entityId: string
  entityName: string | null
  workspaceId: string | null
  deletedById: string
  auditLogId: string | null
  remove: (tx: Prisma.TransactionClient) => Promise<unknown>
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const db = dbOf(tx)
    const data = await captureDeletion(db, await schemaOf(db), ROOT_TABLE[input.entityType], [input.entityId])
    await tx.deletionSnapshot.create({
      data: {
        auditLogId: input.auditLogId,
        entityType: input.entityType,
        entityId: input.entityId,
        entityName: input.entityName,
        workspaceId: input.workspaceId,
        source: "delete",
        dataAsOf: new Date(),
        data: data as unknown as Prisma.InputJsonValue,
        counts: snapshotCounts(data),
        deletedById: input.deletedById,
      },
    })
    await input.remove(tx)
  }, TX)
}

export type RestoreFailure = "NOT_RESTORABLE" | "ALREADY_RESTORED" | "ALREADY_EXISTS" | "PARENT_MISSING"

const FAILURE_MESSAGE: Record<RestoreFailure, string> = {
  NOT_RESTORABLE: "There is no copy of this to restore.",
  ALREADY_RESTORED: "This has already been restored.",
  ALREADY_EXISTS: "It is already back.",
  PARENT_MISSING: "What it belonged to no longer exists. Restore its project first.",
}

export type RestoreOutcome =
  | {
      ok: true
      entityType: string
      entityId: string
      entityName: string | null
      fromBackup: boolean
      result: RestoreResult
    }
  | { ok: false; code: RestoreFailure; message: string }

function failed(code: RestoreFailure): RestoreOutcome {
  return { ok: false, code, message: FAILURE_MESSAGE[code] }
}

/** Puts back what the delete behind `auditLogId` removed. Once: a second call is ALREADY_RESTORED. */
export async function restoreDeletion(auditLogId: string, userId: string): Promise<RestoreOutcome> {
  const snap = await prisma.deletionSnapshot.findUnique({
    where: { auditLogId },
    select: { id: true, entityType: true, entityId: true, entityName: true, source: true, restoredAt: true },
  })
  if (!snap) return failed("NOT_RESTORABLE")
  if (snap.restoredAt) return failed("ALREADY_RESTORED")
  try {
    const result = await prisma.$transaction(async (tx) => {
      // The claim first: two admins pressing Restore at once — one wins, the other gets ALREADY_RESTORED.
      const claimed = await tx.deletionSnapshot.updateMany({
        where: { id: snap.id, restoredAt: null },
        data: { restoredAt: new Date(), restoredById: userId },
      })
      if (!claimed.count) throw Object.assign(new Error("already restored"), { code: "ALREADY_RESTORED" })
      const row = await tx.deletionSnapshot.findUniqueOrThrow({ where: { id: snap.id }, select: { data: true } })
      const db = dbOf(tx)
      return restoreSnapshot(db, await schemaOf(db), row.data as unknown as SnapshotData)
    }, TX)
    return {
      ok: true,
      entityType: snap.entityType,
      entityId: snap.entityId,
      entityName: snap.entityName,
      fromBackup: snap.source === "backup",
      result,
    }
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (code === "ALREADY_RESTORED" || code === "ALREADY_EXISTS" || code === "PARENT_MISSING") return failed(code)
    throw error
  }
}

/** On every delete row of the audit list. Absent = nothing to restore (older delete, other kinds). */
export type RestoreInfo = {
  available: boolean
  restoredAt: string | null
  /** When the copy was taken: the moment of the delete, or the backup it came from. */
  dataAsOf: string
  fromBackup: boolean
}

export async function restoreInfoFor(auditLogIds: string[]): Promise<Map<string, RestoreInfo>> {
  const out = new Map<string, RestoreInfo>()
  if (!auditLogIds.length) return out
  const rows = await prisma.deletionSnapshot.findMany({
    where: { auditLogId: { in: auditLogIds } },
    select: { auditLogId: true, restoredAt: true, dataAsOf: true, source: true },
  })
  for (const r of rows) {
    if (!r.auditLogId) continue
    out.set(r.auditLogId, {
      available: !r.restoredAt,
      restoredAt: r.restoredAt?.toISOString() ?? null,
      dataAsOf: r.dataAsOf.toISOString(),
      fromBackup: r.source === "backup",
    })
  }
  return out
}

/** What comes back, in the words people use: "120 tasks, 4 lists, 14 files". */
export type RestoreCounts = { lists: number; tasks: number; files: number; comments: number; sheets: number; members: number }

export type RestoreDetail = RestoreInfo & { restoredBy: { id: string; name: string | null } | null; counts: RestoreCounts }

export async function restoreDetailFor(auditLogId: string): Promise<RestoreDetail | null> {
  const r = await prisma.deletionSnapshot.findUnique({
    where: { auditLogId },
    select: { entityType: true, restoredAt: true, restoredById: true, dataAsOf: true, source: true, counts: true },
  })
  if (!r) return null
  const c = (r.counts ?? {}) as Record<string, number>
  const restoredBy = r.restoredById
    ? await prisma.user.findUnique({ where: { id: r.restoredById }, select: { id: true, name: true } })
    : null
  return {
    available: !r.restoredAt,
    restoredAt: r.restoredAt?.toISOString() ?? null,
    dataAsOf: r.dataAsOf.toISOString(),
    fromBackup: r.source === "backup",
    restoredBy,
    counts: {
      lists: c.TaskList ?? 0,
      // A task's own row is the thing restored; its subtasks are what come with it.
      tasks: Math.max(0, (c.Task ?? 0) - (r.entityType === "task" ? 1 : 0)),
      files: c.Attachment ?? 0,
      comments: c.Comment ?? 0,
      sheets: c.ProjectSheet ?? 0,
      members: c.ProjectMember ?? 0,
    },
  }
}
