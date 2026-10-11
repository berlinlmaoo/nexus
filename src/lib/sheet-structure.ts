// Formula upkeep when a sheet's structure loses rows or columns.
//
// Formulas are stored in id-space (see sheet-formula.ts), so inserting or moving rows/columns never
// touches them. Deleting is the exception: a range whose CORNER row/column disappears would otherwise
// turn #REF! as a whole, where Sheets just shrinks it. This rewrites those ranges, in the same
// transaction as the delete, so every client (and the export) sees the shrunk formula.
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { isFormulaCell, rewriteForDeletion } from "@/lib/sheet-formula"

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

  return {
    apply: async (tx, userId) => {
      const out: Rewritten[] = []
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
