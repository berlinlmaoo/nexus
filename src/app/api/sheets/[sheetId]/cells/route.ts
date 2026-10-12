export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  MAX_CELLS_PER_WRITE, MAX_ROWS_PER_WRITE,
  coerceCellValue, normalizeCellStyle, protectedCellsBlock, readCells, readStyles, resolveSheetAccess,
} from "@/lib/project-sheets"
import { emitSheetCells, originTabOf } from "@/lib/socket-emitter"

// PATCH /api/sheets/[sheetId]/cells — the hot path.
//
// One payload shape serves both a single blur-save and a pasted block:
//   { edits: [{ rowId, values: { [columnId]: value } }] }
//
// Each row is written with ONE atomic statement:
//   cells = jsonb_strip_nulls(cells || $patch)
// There is no read-modify-write, so two people editing DIFFERENT CELLS OF THE SAME ROW both win —
// which is the entire reason cells are stored per-row keyed by column id. A null value drops the
// key (jsonb_strip_nulls), so "clear a cell" shrinks the json instead of filling it with nulls.
// (strip_nulls recurses, so it also walks into a formula cell's { f } — harmless, because `f` is
// always a non-null string and nothing inside it can be stripped.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const { sheetId } = await params

    const access = await resolveSheetAccess(me, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })
    const columnsById = new Map(access.sheet.columns.map((c) => [c.id, c]))

    const body = (await req.json().catch(() => ({}))) as {
      edits?: { rowId?: unknown; values?: unknown }[]
      /** Per-cell formatting: [{ rowId, values: { [columnId]: style | null } }], same shape as edits. */
      styles?: { rowId?: unknown; values?: unknown }[]
    }
    const edits = Array.isArray(body.edits) ? body.edits : []
    const styleEdits = Array.isArray(body.styles) ? body.styles : []
    if (!edits.length && !styleEdits.length) return NextResponse.json({ error: "edits kosong." }, { status: 400 })
    if (edits.length > MAX_ROWS_PER_WRITE || styleEdits.length > MAX_ROWS_PER_WRITE) {
      return NextResponse.json({ error: `Maksimal ${MAX_ROWS_PER_WRITE} baris sekali kirim.` }, { status: 422 })
    }

    // Build + validate every patch BEFORE writing anything, so a bad payload can't half-apply.
    const patches: { rowId: string; patch: Record<string, unknown> }[] = []
    let cellCount = 0
    for (const e of edits) {
      const rowId = typeof e?.rowId === "string" ? e.rowId : ""
      if (!rowId) return NextResponse.json({ error: "Ada edit tanpa rowId." }, { status: 400 })
      const values = e?.values && typeof e.values === "object" ? (e.values as Record<string, unknown>) : null
      if (!values) return NextResponse.json({ error: "Ada edit tanpa values." }, { status: 400 })

      const patch: Record<string, unknown> = {}
      for (const [columnId, raw] of Object.entries(values)) {
        const col = columnsById.get(columnId)
        // Silently ignoring an unknown column would let a stale client write orphan keys forever.
        if (!col) return NextResponse.json({ error: `Kolom "${columnId}" nggak ada di sheet ini.` }, { status: 422 })
        patch[columnId] = coerceCellValue(col.type, raw)
        cellCount += 1
      }
      if (Object.keys(patch).length) patches.push({ rowId, patch })
    }
    // Formatting patches, validated the same way. A style lives in its own column (`styles`), so the
    // cell-history trigger never records formatting as a value change.
    const stylePatches: { rowId: string; patch: Record<string, unknown> }[] = []
    for (const e of styleEdits) {
      const rowId = typeof e?.rowId === "string" ? e.rowId : ""
      const values = e?.values && typeof e.values === "object" ? (e.values as Record<string, unknown>) : null
      if (!rowId || !values) return NextResponse.json({ error: "Ada format tanpa rowId/values." }, { status: 400 })
      const patch: Record<string, unknown> = {}
      for (const [columnId, raw] of Object.entries(values)) {
        if (!columnsById.has(columnId)) return NextResponse.json({ error: `Kolom "${columnId}" nggak ada di sheet ini.` }, { status: 422 })
        patch[columnId] = normalizeCellStyle(raw)
        cellCount += 1
      }
      if (Object.keys(patch).length) stylePatches.push({ rowId, patch })
    }
    if (cellCount > MAX_CELLS_PER_WRITE) {
      return NextResponse.json({ error: `Maksimal ${MAX_CELLS_PER_WRITE} sel sekali kirim.` }, { status: 422 })
    }

    // Protected ranges (Data › Protect sheets and ranges, "Restrict who can edit"): enforced here, not
    // only in the grid — a hidden button is not a lock.
    const touched: { rowId: string; colId: string }[] = []
    for (const p of [...patches, ...stylePatches]) for (const colId of Object.keys(p.patch)) touched.push({ rowId: p.rowId, colId })
    const blocked = await protectedCellsBlock(me, access.sheet, touched)
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 })

    // `sheetId` in the WHERE is the second lock on the door: even with a valid rowId from another
    // sheet, the update matches nothing.
    //
    // updatedAt is the row's VERSION for every client ("newer wins", realtime bug 4, 13 Oct 2026): strictly
    // increasing per row, in the order the writes commit. NOW() was the transaction's START time, so of two
    // writes racing on one cell the one that committed last could carry the older stamp; browsers that saw
    // both kept the wrong one and the screens disagreed with the server. clock_timestamp() is read after the
    // row lock is granted (the SET is evaluated on the locked row), and "+1 ms over the stored value" keeps it
    // strictly increasing at the column's millisecond precision even within the same millisecond.
    const updated = await prisma.$transaction([
      ...patches.map(({ rowId, patch }) => prisma.$executeRaw`
        UPDATE "SheetRow"
        SET "cells" = jsonb_strip_nulls("cells" || ${JSON.stringify(patch)}::jsonb),
            "updatedById" = ${me},
            "updatedAt" = GREATEST(clock_timestamp()::timestamp(3), "updatedAt" + interval '1 millisecond')
        WHERE "id" = ${rowId} AND "sheetId" = ${sheetId}
      `),
      // A null style drops the key; an empty map goes back to NULL.
      ...stylePatches.map(({ rowId, patch }) => prisma.$executeRaw`
        UPDATE "SheetRow"
        SET "styles" = NULLIF(jsonb_strip_nulls(COALESCE("styles", '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb), '{}'::jsonb),
            "updatedById" = ${me},
            "updatedAt" = GREATEST(clock_timestamp()::timestamp(3), "updatedAt" + interval '1 millisecond')
        WHERE "id" = ${rowId} AND "sheetId" = ${sheetId}
      `),
    ])
    const applied = updated.reduce((sum, n) => sum + n, 0)

    // Return the rows so the client can patch its cache instead of refetching — a refetch mid-typing
    // is what unmounts the editing cell and loses focus.
    const rows = await prisma.sheetRow.findMany({
      where: { id: { in: [...new Set([...patches, ...stylePatches].map((p) => p.rowId))] }, sheetId },
      select: { id: true, cells: true, styles: true, updatedAt: true },
    })

    const payload = rows.map((r) => ({ id: r.id, cells: readCells(r.cells), styles: readStyles(r.styles), updatedAt: r.updatedAt }))
    // actorId travels with it so the sender's own browser can ignore the echo of its own write.
    emitSheetCells(sheetId, payload, me, originTabOf(req))

    return NextResponse.json({ updated: applied, rows: payload })
  } catch (error) {
    console.error("Error patching sheet cells:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
