import path from "path"
import { unlink } from "fs/promises"
import type { NextRequest } from "next/server"
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
  type SnapshotLink,
  type SoftRow,
} from "@/lib/deletion-snapshot-core"
import {
  conflictMessage,
  entityLabelOf,
  parentMissingMessage,
  parentNounOf,
  restoreCountsOf,
  rootTableOf,
  type RestoreCounts,
  type RestoreOpen,
  type SnapshotMeta,
} from "@/lib/deletion-entities"
import { afterRestoreInTx, beforeRestoreInTx } from "@/lib/deletion-restore-rules"
import { logAudit } from "@/lib/audit"
import { emitAuditChanged } from "@/lib/socket-emitter"
import { deleteStoredFile } from "@/lib/vault"

/**
 * Restorable deletes (owner, 8 Oct 2026: Control Room → Audit → Restore; the same day, for every
 * delete). How rows are collected and written back lives in deletion-snapshot-core.ts, what each kind
 * is called and counted in deletion-entities.ts; this is the Prisma side — the transaction, the
 * DeletionSnapshot row, and the claim that lets a delete be restored once.
 *
 * Three shapes of copy:
 *   - "delete": the rows a DELETE takes with it (deleteKeepingSnapshot / restorableDelete).
 *   - "soft": columns a "delete" only flips, e.g. Post.deletedAt (softDeleteKeepingSnapshot).
 *   - a sheet column, which has no row of its own (deleteColumnKeepingSnapshot).
 * "backup" copies come from scripts/deletion-snapshot-from-backup.mjs.
 */

/** An audit `entityType` listed in deletion-entities.ts RESTORABLE. */
export type DeletableEntity = string

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

type SnapshotInput = {
  entityType: DeletableEntity
  entityId: string
  entityName: string | null
  workspaceId: string | null
  deletedById: string
  auditLogId: string | null
  /** Where "Open …" goes after a restore, and the ids the restore's follow-ups need. */
  meta?: SnapshotMeta
}

async function keep(tx: Prisma.TransactionClient, input: SnapshotInput, source: string, data: SnapshotData, counts: Record<string, number>) {
  await tx.deletionSnapshot.create({
    data: {
      auditLogId: input.auditLogId,
      entityType: input.entityType,
      entityId: input.entityId,
      entityName: input.entityName,
      workspaceId: input.workspaceId,
      source,
      dataAsOf: new Date(),
      data: data as unknown as Prisma.InputJsonValue,
      counts,
      meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      deletedById: input.deletedById,
    },
    select: { id: true },
  })
}

function sum(counts: Record<string, number>): number {
  return Object.entries(counts).filter(([k]) => !k.startsWith("moved:")).reduce((n, [, v]) => n + v, 0)
}

/**
 * Deletes exactly as the routes always have, after keeping every row the delete takes with it. One
 * transaction: no copy, no delete.
 *
 * `rootIds`: a bulk delete (sheet rows, a Vault trash) — every root row, restored all or nothing.
 * `extraRoots`: rows of another table the same action deletes (a withdrawn submission's task).
 * `before`: a "move then delete" (sections, folders, org units) moves what was inside out first and
 * returns those moves as links (`movedTo` = where it put them), so a restore moves them back.
 */
export async function deleteKeepingSnapshot(
  input: SnapshotInput & {
    rootIds?: string[]
    extraRoots?: { table: string; ids: string[] }[]
    before?: (tx: Prisma.TransactionClient) => Promise<SnapshotLink[] | void>
    remove: (tx: Prisma.TransactionClient) => Promise<unknown>
  },
): Promise<{ rows: number }> {
  let rows = 0
  await prisma.$transaction(async (tx) => {
    const moved = (await input.before?.(tx)) ?? []
    const db = dbOf(tx)
    const data = await captureDeletion(db, await schemaOf(db), rootTableOf(input.entityType), input.rootIds ?? [input.entityId], {
      extraRoots: input.extraRoots,
    })
    if (moved.length) data.links = [...moved, ...data.links]
    const counts: Record<string, number> = snapshotCounts(data)
    for (const link of moved) counts[`moved:${link.table}.${link.column}`] = (counts[`moved:${link.table}.${link.column}`] ?? 0) + 1
    rows = sum(counts)
    await keep(tx, input, "delete", data, counts)
    await input.remove(tx)
  }, TX)
  // The route wrote the audit row BEFORE this copy existed, so an audit view that refetched on that
  // write saw the delete without its Restore block. Ping again now that the copy is committed.
  emitAuditChanged()
  return { rows }
}

// Bookkeeping columns a flag flip touches as a side effect: not part of what a restore puts back.
const SOFT_IGNORED = new Set(["updatedAt"])

/**
 * A "delete" that only flips columns (Post.deletedAt, Quest.isActive, an event's CANCELLED status, a
 * revoked extra day off, an archived office, a trashed Vault item): `apply` does the flip; the copy is
 * every column it changed, before and after. Restore writes the before back where the row still holds
 * the after. Rows `apply` did not change (already deleted) are not kept; nothing changed → no copy.
 */
export async function softDeleteKeepingSnapshot(
  input: SnapshotInput & { ids?: string[]; apply: (tx: Prisma.TransactionClient) => Promise<unknown> },
): Promise<{ changed: number }> {
  const table = rootTableOf(input.entityType)
  const ids = input.ids ?? [input.entityId]
  let changed = 0
  await prisma.$transaction(async (tx) => {
    const db = dbOf(tx)
    const schema = await schemaOf(db)
    const pk = schema.pk.get(table)?.[0] ?? "id"
    const read = async () => {
      const rows = await db.query<{ r: Record<string, unknown> | string }>(
        `select to_jsonb(t) as r from "${table}" t where t."${pk}"::text = any($1::text[])`,
        [ids],
      )
      const out = new Map<string, Record<string, unknown>>()
      for (const x of rows) {
        const r = (typeof x.r === "string" ? JSON.parse(x.r) : x.r) as Record<string, unknown>
        out.set(String(r[pk]), r)
      }
      return out
    }
    const before = await read()
    await input.apply(tx)
    const after = await read()
    const rows: SoftRow[] = []
    for (const [id, was] of before) {
      const now = after.get(id)
      if (!now) continue
      const set: Record<string, unknown> = {}
      const flipped: Record<string, unknown> = {}
      for (const col of Object.keys(was)) {
        if (SOFT_IGNORED.has(col) || JSON.stringify(was[col] ?? null) === JSON.stringify(now[col] ?? null)) continue
        set[col] = was[col] ?? null
        flipped[col] = now[col] ?? null
      }
      if (Object.keys(set).length) rows.push({ id, set, was: flipped })
    }
    changed = rows.length
    if (!rows.length) return
    const data: SnapshotData = { v: 1, root: { table, ids: rows.map((r) => r.id) }, tables: {}, links: [], soft: { table, rows } }
    await keep(tx, input, "soft", data, { [table]: rows.length })
  }, TX)
  if (changed) emitAuditChanged()
  return { changed }
}

/**
 * A sheet column delete: the column lives in ProjectSheet.columns and as one key in every row's
 * cells, so there is no row to copy. Keeps the definition, its index and each row's value; `remove`
 * then drops it as the route always has.
 */
export async function deleteColumnKeepingSnapshot(
  input: SnapshotInput & { sheetId: string; columnId: string; maxColumns?: number; remove: (tx: Prisma.TransactionClient) => Promise<unknown> },
): Promise<{ cells: number }> {
  let cells = 0
  await prisma.$transaction(async (tx) => {
    const db = dbOf(tx)
    const [sheet] = await db.query<{ columns: unknown }>(`select columns from "ProjectSheet" where id = $1 for update`, [input.sheetId])
    const raw = sheet ? (typeof sheet.columns === "string" ? JSON.parse(sheet.columns) : sheet.columns) : []
    const list = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[]
    const index = list.findIndex((c) => c && c.id === input.columnId)
    if (index < 0) throw new Error("column not found")
    // Wrapped in an object so a driver handing jsonb back as text is still unambiguous.
    const values = await db.query<{ id: string; w: { v: unknown } | string }>(
      `select id, jsonb_build_object('v', cells -> $2::text) as w from "SheetRow" where "sheetId" = $1 and (cells -> $2::text) is not null`,
      [input.sheetId, input.columnId],
    )
    const kept: Record<string, unknown> = {}
    for (const r of values) kept[r.id] = (typeof r.w === "string" ? (JSON.parse(r.w) as { v: unknown }) : r.w).v
    cells = values.length
    const data: SnapshotData = {
      v: 1,
      root: { table: "ProjectSheet", ids: [] },
      tables: {},
      links: [],
      column: { sheetId: input.sheetId, index, def: list[index], cells: kept, maxColumns: input.maxColumns },
    }
    await keep(tx, input, "delete", data, { SheetCell: cells })
    await input.remove(tx)
  }, TX)
  emitAuditChanged()
  return { cells }
}

type AuditInput = {
  userId: string
  request?: NextRequest | Request
  metadata?: Record<string, unknown>
  /** The audit verb; "delete" unless the action has its own (a revoke). */
  action?: string
}

/**
 * The usual shape of a restorable delete in a route: the audit row first (awaited, so the copy can
 * point at it), then the delete with its copy. Returns the audit row's id.
 */
export async function restorableDelete(
  input: Omit<Parameters<typeof deleteKeepingSnapshot>[0], "deletedById" | "auditLogId"> & AuditInput,
): Promise<{ auditLogId: string | null; rows: number }> {
  const auditLogId = await logAudit({
    action: input.action ?? "delete",
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName ?? undefined,
    userId: input.userId,
    request: input.request,
    metadata: input.metadata,
  })
  const { rows } = await deleteKeepingSnapshot({ ...input, deletedById: input.userId, auditLogId })
  return { auditLogId, rows }
}

/** restorableDelete for a soft delete. */
export async function restorableSoftDelete(
  input: Omit<Parameters<typeof softDeleteKeepingSnapshot>[0], "deletedById" | "auditLogId"> & AuditInput,
): Promise<{ auditLogId: string | null; changed: number }> {
  const auditLogId = await logAudit({
    action: input.action ?? "delete",
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName ?? undefined,
    userId: input.userId,
    request: input.request,
    metadata: input.metadata,
  })
  const { changed } = await softDeleteKeepingSnapshot({ ...input, deletedById: input.userId, auditLogId })
  return { auditLogId, changed }
}

export type RestoreFailure = "NOT_RESTORABLE" | "ALREADY_RESTORED" | "ALREADY_EXISTS" | "PARENT_MISSING" | "CONFLICT"

const FAILURE_MESSAGE: Record<Exclude<RestoreFailure, "PARENT_MISSING" | "CONFLICT">, string> = {
  NOT_RESTORABLE: "There is no copy of this to restore.",
  ALREADY_RESTORED: "This has already been restored.",
  ALREADY_EXISTS: "It is already back.",
}

export type RestoreOutcome =
  | {
      ok: true
      entityType: string
      entityId: string
      entityName: string | null
      fromBackup: boolean
      result: RestoreResult
      meta: SnapshotMeta | null
    }
  | { ok: false; code: RestoreFailure; message: string; entityType: string | null; parent: string | null }

function failed(code: RestoreFailure, entityType: string | null = null, detail: { table?: string | null; soft?: boolean } = {}): RestoreOutcome {
  const message = code === "PARENT_MISSING"
    ? parentMissingMessage(entityType ?? "", detail.table)
    : code === "CONFLICT"
      ? conflictMessage(entityType ?? "", detail.soft)
      : FAILURE_MESSAGE[code]
  return { ok: false, code, message, entityType, parent: code === "PARENT_MISSING" ? parentNounOf(detail.table) : null }
}

function metaOf(value: unknown): SnapshotMeta | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as SnapshotMeta) : null
}

/** Puts back what the delete behind `auditLogId` removed. Once: a second call is ALREADY_RESTORED. */
export async function restoreDeletion(auditLogId: string, userId: string): Promise<RestoreOutcome> {
  const snap = await prisma.deletionSnapshot.findUnique({
    where: { auditLogId },
    select: { id: true, entityType: true, entityId: true, entityName: true, source: true, restoredAt: true, meta: true },
  })
  if (!snap) return failed("NOT_RESTORABLE")
  if (snap.restoredAt) return failed("ALREADY_RESTORED", snap.entityType)
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
      const data = row.data as unknown as SnapshotData
      await beforeRestoreInTx(db, snap.entityType, data)
      const restored = await restoreSnapshot(db, await schemaOf(db), data)
      await afterRestoreInTx(db, snap.entityType, data)
      return restored
    }, TX)
    return {
      ok: true,
      entityType: snap.entityType,
      entityId: snap.entityId,
      entityName: snap.entityName,
      fromBackup: snap.source === "backup",
      result,
      meta: metaOf(snap.meta),
    }
  } catch (error) {
    const e = error as { code?: unknown; table?: unknown }
    const code = e?.code
    if (code === "ALREADY_RESTORED" || code === "ALREADY_EXISTS" || code === "PARENT_MISSING" || code === "CONFLICT") {
      return failed(code, snap.entityType, { table: typeof e.table === "string" ? e.table : null, soft: snap.source === "soft" })
    }
    throw error
  }
}

/** On every row of the audit list that kept a copy. Absent = nothing to restore (older delete, other kinds). */
export type RestoreInfo = {
  available: boolean
  restoredAt: string | null
  /** When the copy was taken: the moment of the delete, or the backup it came from. */
  dataAsOf: string
  fromBackup: boolean
  /** A delete that only flipped a flag (a post's deletedAt, a trashed Vault item): restoring switches it back. */
  soft: boolean
  /** English noun for what was deleted ("comment", "sheet rows"); clients translate the ones they know. */
  entityLabel: string
  /** What comes back (see deletion-entities.ts RestoreCounts). */
  counts: RestoreCounts
  /** Where "Open …" goes once it is back; null when there is no page for it. */
  open: RestoreOpen | null
}

type SnapshotRowLike = {
  entityType: string
  entityId: string
  restoredAt: Date | null
  dataAsOf: Date
  source: string
  counts: unknown
  meta: unknown
}

function infoOf(r: SnapshotRowLike): RestoreInfo {
  const meta = metaOf(r.meta)
  // Copies taken before `meta` existed are projects and tasks: their own page is the link.
  const open = meta && "open" in meta
    ? meta.open ?? null
    : r.entityType === "project" || r.entityType === "task"
      ? { type: r.entityType, id: r.entityId }
      : null
  return {
    available: !r.restoredAt,
    restoredAt: r.restoredAt?.toISOString() ?? null,
    dataAsOf: r.dataAsOf.toISOString(),
    fromBackup: r.source === "backup",
    soft: r.source === "soft",
    entityLabel: entityLabelOf(r.entityType),
    counts: restoreCountsOf(r.entityType, (r.counts ?? {}) as Record<string, unknown>),
    open,
  }
}

const INFO_SELECT = {
  auditLogId: true, entityType: true, entityId: true, restoredAt: true, dataAsOf: true, source: true, counts: true, meta: true,
} as const

export async function restoreInfoFor(auditLogIds: string[]): Promise<Map<string, RestoreInfo>> {
  const out = new Map<string, RestoreInfo>()
  if (!auditLogIds.length) return out
  const rows = await prisma.deletionSnapshot.findMany({ where: { auditLogId: { in: auditLogIds } }, select: INFO_SELECT })
  for (const r of rows) if (r.auditLogId) out.set(r.auditLogId, infoOf(r))
  return out
}

export type { RestoreCounts, RestoreOpen }

export type RestoreDetail = RestoreInfo & { restoredBy: { id: string; name: string | null } | null }

export async function restoreDetailFor(auditLogId: string): Promise<RestoreDetail | null> {
  const r = await prisma.deletionSnapshot.findUnique({ where: { auditLogId }, select: { ...INFO_SELECT, restoredById: true } })
  if (!r) return null
  const restoredBy = r.restoredById
    ? await prisma.user.findUnique({ where: { id: r.restoredById }, select: { id: true, name: true } })
    : null
  return { ...infoOf(r), restoredBy }
}

// ─── 90-day purge ──────────────────────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads")

/** A file a delete left on disk for a restore: an /api/files/… upload or a Vault storage key. */
async function removeKeptFile(kind: string, ref: string): Promise<boolean> {
  if (kind === "vault") {
    await deleteStoredFile(ref)
    return true
  }
  if (!ref.startsWith("/api/files/")) return false
  const full = path.resolve(UPLOADS_DIR, ref.slice("/api/files/".length))
  if (!full.startsWith(UPLOADS_DIR + path.sep)) return false
  try {
    await unlink(full)
    return true
  } catch {
    return false // already gone
  }
}

async function stillUsed(ref: string, cutoff: Date): Promise<boolean> {
  const [row] = await prisma.$queryRaw<{ used: boolean }[]>`
    select (
      exists (select 1 from "Attachment" a where a.url = ${ref})
      or exists (select 1 from "PnlExpenseAttachment" p where p.url = ${ref})
      or exists (select 1 from "Message" m where m."attachmentUrl" = ${ref})
      or exists (select 1 from "VaultItem" v where v."storageKey" = ${ref})
      or exists (select 1 from "DeletionSnapshot" s where s."createdAt" >= ${cutoff} and strpos(s.data::text, ${ref}) > 0)
    ) as used`
  return Boolean(row?.used)
}

/**
 * Drops copies older than `cutoff` (restored or not), then the files only they still pointed at.
 * Deletes no longer unlink task attachments, P&L receipts or Vault files (a restore needs them); this
 * is where they go: a file is removed only when no live row and no newer copy refers to it.
 */
export async function purgeDeletionSnapshots(cutoff: Date): Promise<{ deleted: number; filesRemoved: number }> {
  const refs = await prisma.$queryRaw<{ kind: string; ref: string }[]>`
    with old as (select data from "DeletionSnapshot" where "createdAt" < ${cutoff})
    select distinct x.kind, x.ref from old, lateral (
      select 'upload'::text as kind, e->>'url' as ref from jsonb_array_elements(coalesce(old.data->'tables'->'Attachment', '[]'::jsonb)) e
      union all
      select 'upload', e->>'url' from jsonb_array_elements(coalesce(old.data->'tables'->'PnlExpenseAttachment', '[]'::jsonb)) e
      union all
      select 'vault', e->>'storageKey' from jsonb_array_elements(coalesce(old.data->'tables'->'VaultItem', '[]'::jsonb)) e where e->>'kind' = 'FILE'
    ) x
    where x.ref is not null`
  const deleted = (await prisma.deletionSnapshot.deleteMany({ where: { createdAt: { lt: cutoff } } })).count
  let filesRemoved = 0
  for (const r of refs) {
    // Checked after the copies are gone and right before each unlink: a restore in between wins.
    if (await stillUsed(r.ref, cutoff)) continue
    if (await removeKeptFile(r.kind, r.ref)) filesRemoved++
  }
  return { deleted, filesRemoved }
}
