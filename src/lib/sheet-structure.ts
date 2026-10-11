// Formula upkeep when a sheet's structure loses rows or columns.
//
// Formulas are stored in id-space (see sheet-formula.ts), so inserting or moving rows/columns never
// touches them. Deleting is the exception: a range whose CORNER row/column disappears would otherwise
// turn #REF! as a whole, where Sheets just shrinks it. This rewrites those ranges, in the same
// transaction as the delete, so every client (and the export) sees the shrunk formula.
import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { ERR, isFormulaCell, rewriteForDeletion } from "@/lib/sheet-formula"
import { readSheetSettings } from "@/lib/project-sheets"

type Rewritten = { id: string; cells: unknown; updatedAt: Date }

/**
 * Plan the rewrite against the order BEFORE the delete (the corners' neighbours are only knowable
 * then), and return an `apply` to run inside the delete's transaction.
 *
 * `columnIds` is the sheet's column order before the delete.
 */
export async function shrinkRangesAfterDeletion(
  sheetId: string,
  columnIds: string[],
  deleted: { rows?: Set<string>; cols?: Set<string> },
): Promise<{ apply: (tx: Prisma.TransactionClient, userId: string) => Promise<Rewritten[]> }> {
  const rows = await prisma.sheetRow.findMany({
    where: { sheetId },
    orderBy: { position: "asc" },
    select: { id: true, cells: true },
  })
  const shape = { columnIds, rowIds: rows.map((r) => r.id) }
  const patches: { rowId: string; patch: Record<string, { f: string }> }[] = []
  for (const row of rows) {
    if (deleted.rows?.has(row.id)) continue
    const cells = (row.cells && typeof row.cells === "object" ? row.cells : {}) as Record<string, unknown>
    const patch: Record<string, { f: string }> = {}
    for (const [colId, raw] of Object.entries(cells)) {
      if (deleted.cols?.has(colId) || !isFormulaCell(raw)) continue
      const next = rewriteForDeletion(raw.f, shape, deleted)
      if (next !== raw.f) patch[colId] = { f: next }
    }
    if (Object.keys(patch).length) patches.push({ rowId: row.id, patch })
  }

  // Data-validation ranges are stored like formula ranges and shrink the same way; a range with
  // nothing left goes, and a rule with no range left goes with it.
  const sheet = await prisma.projectSheet.findUnique({ where: { id: sheetId }, select: { settings: true } })
  const settings = readSheetSettings(sheet?.settings)
  let nextValidations: typeof settings.validations | null = null
  if (settings.validations?.length) {
    const rewritten = settings.validations
      .map((v) => ({
        ...v,
        ranges: v.ranges.map((r) => rewriteForDeletion(r, shape, deleted)).filter((r) => r !== ERR.ref),
        ...(v.source ? { source: rewriteForDeletion(v.source, shape, deleted) } : {}),
      }))
      .filter((v) => v.ranges.length)
    if (JSON.stringify(rewritten) !== JSON.stringify(settings.validations)) nextValidations = rewritten
  }

  return {
    apply: async (tx, userId) => {
      const out: Rewritten[] = []
      if (nextValidations) {
        // Only this key is replaced, inside the delete's transaction.
        await tx.$executeRaw`
          UPDATE "ProjectSheet"
          SET "settings" = COALESCE("settings", '{}'::jsonb) || jsonb_build_object('validations', ${JSON.stringify(nextValidations)}::jsonb)
          WHERE "id" = ${sheetId}
        `
      }
      for (const { rowId, patch } of patches) {
        // Merge only the rewritten keys (never the whole row), so a concurrent edit to another cell
        // of the same row survives — the same rule the cells PATCH follows.
        const res = await tx.$queryRaw<Rewritten[]>`
          UPDATE "SheetRow"
          SET "cells" = "cells" || ${JSON.stringify(patch)}::jsonb,
              "updatedById" = ${userId},
              "updatedAt" = NOW()
          WHERE "id" = ${rowId} AND "sheetId" = ${sheetId}
          RETURNING "id", "cells", "updatedAt"
        `
        out.push(...res)
      }
      return out
    },
  }
}

/**
 * Copy a sheet — columns, settings, rows with values, formatting and heights — into `projectId`.
 *
 * Rows get NEW ids, so every formula's row references are rewritten to the copies (and hidden rows
 * and merges follow too); copying the stored text as-is would leave every reference pointing at the
 * ORIGINAL sheet's rows, i.e. #REF! everywhere. Column ids are per sheet and stay as they are.
 */
export async function copySheet(
  sourceId: string,
  target: { projectId: string; name: string; position: number; createdById: string | null },
): Promise<{ id: string }> {
  const source = await prisma.projectSheet.findUnique({
    where: { id: sourceId },
    select: { columns: true, settings: true },
  })
  if (!source) throw new Error("sheet not found")
  const rows = await prisma.sheetRow.findMany({
    where: { sheetId: sourceId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, cells: true, styles: true, height: true },
  })
  const idMap = new Map(rows.map((r) => [r.id, `r${randomUUID().replace(/-/g, "").slice(0, 24)}`]))
  const remap = (f: string) => f.replace(/\{(\$?[^!}]+)!(\$?)([^}]+)\}/g, (whole, col: string, abs: string, row: string) => {
    const next = idMap.get(row)
    return next ? `{${col}!${abs}${next}}` : whole
  })
  const settings = (source.settings && typeof source.settings === "object" ? { ...(source.settings as Record<string, unknown>) } : {}) as Record<string, unknown>
  if (Array.isArray(settings.hiddenRows)) settings.hiddenRows = (settings.hiddenRows as string[]).map((id) => idMap.get(id) ?? id)
  if (Array.isArray(settings.merges)) settings.merges = (settings.merges as { r: string }[]).map((m) => ({ ...m, r: idMap.get(m.r) ?? m.r }))
  // Validation ranges, dropdown sources and custom formulas point at rows too.
  if (Array.isArray(settings.validations)) {
    settings.validations = (settings.validations as { ranges?: string[]; source?: string; formula?: string }[]).map((v) => ({
      ...v,
      ...(Array.isArray(v.ranges) ? { ranges: v.ranges.map(remap) } : {}),
      ...(v.source ? { source: remap(v.source) } : {}),
      ...(v.formula ? { formula: remap(v.formula) } : {}),
    }))
  }

  return prisma.$transaction(async (tx) => {
    const copy = await tx.projectSheet.create({
      data: {
        projectId: target.projectId, name: target.name, position: target.position,
        columns: (source.columns ?? []) as object, settings: settings as object, createdById: target.createdById,
      },
      select: { id: true },
    })
    if (rows.length) {
      await tx.sheetRow.createMany({
        data: rows.map((r) => {
          const cells = { ...((r.cells ?? {}) as Record<string, unknown>) }
          for (const [k, v] of Object.entries(cells)) if (isFormulaCell(v)) cells[k] = { f: remap(v.f) }
          return {
            id: idMap.get(r.id), sheetId: copy.id, position: r.position, cells: cells as object,
            height: r.height, ...(r.styles ? { styles: r.styles as object } : {}),
          }
        }),
      })
    }
    return copy
  })
}
