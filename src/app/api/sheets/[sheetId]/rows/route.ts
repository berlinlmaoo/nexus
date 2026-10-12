export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  MAX_ROWS_PER_WRITE, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN,
  coerceCellValue, normalizeCellStyle, protectedRowsBlock, readCells, readStyles, resolveSheetAccess,
} from "@/lib/project-sheets"
import { emitSheetStructure, originTabOf } from "@/lib/socket-emitter"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { shrinkRangesAfterDeletion } from "@/lib/sheet-structure"

const MAX_INSERT = 1000
/** Below this the midpoints have run out of float precision and the sheet needs renumbering. */
const MIN_GAP = 1e-6

/** Position between two neighbours, or after the last row when `next` is absent. */
function midpoint(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 0
  if (prev === null) return (next as number) - 1
  if (next === null) return prev + 1
  return (prev + next) / 2
}

/** Rewrite positions to 0,1,2… — only when midpoints have collapsed. */
async function renumber(sheetId: string) {
  await prisma.$executeRaw`
    UPDATE "SheetRow" r
    SET "position" = s.rn - 1
    FROM (SELECT "id", row_number() OVER (ORDER BY "position" ASC, "createdAt" ASC) AS rn
          FROM "SheetRow" WHERE "sheetId" = ${sheetId}) s
    WHERE r."id" = s."id" AND r."sheetId" = ${sheetId}
  `
}

// POST — add rows.
//   { count }               append N blank rows
//   { afterRowId }          insert one row right below that row
//   { rows: [ {colId: v} ] } bulk insert with values (paste past the bottom, CSV import)
//   { positions }           optional, parallel to `rows` — restores rows at their ORIGINAL spots,
//                           which is what makes undo-of-a-delete put them back where they were
//                           instead of dumping them at the bottom.
export async function POST(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })
    const columnsById = new Map(access.sheet.columns.map((c) => [c.id, c]))

    const body = (await req.json().catch(() => ({}))) as {
      count?: unknown; afterRowId?: unknown; beforeRowId?: unknown; rows?: unknown; positions?: unknown; styles?: unknown
    }
    // Optional, parallel to `rows`: the formatting to restore with them (undo of a delete).
    const incomingStyles = Array.isArray(body.styles) ? (body.styles as unknown[]) : null
    const incoming = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : null
    const positions = Array.isArray(body.positions)
      ? (body.positions as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      : null
    const count = incoming ? incoming.length : Math.max(1, Math.min(MAX_INSERT, Number(body.count) || 1))
    if (count > MAX_INSERT) return NextResponse.json({ error: `Maksimal ${MAX_INSERT} baris.` }, { status: 422 })

    // `beforeRowId` exists because null afterRowId means APPEND, so "insert above the first row"
    // had no way to be expressed. It resolves to "after whatever precedes it", or to a position
    // below the current minimum when there is nothing before it.
    const beforeRowId = typeof body.beforeRowId === "string" ? body.beforeRowId : null
    let afterRowId = typeof body.afterRowId === "string" ? body.afterRowId : null
    let insertAtTop = false
    if (beforeRowId && !afterRowId) {
      const target = await prisma.sheetRow.findFirst({
        where: { id: beforeRowId, sheetId }, select: { position: true },
      })
      if (!target) return NextResponse.json({ error: "Baris acuannya nggak ketemu." }, { status: 404 })
      const prev = await prisma.sheetRow.findFirst({
        where: { sheetId, position: { lt: target.position } },
        orderBy: { position: "desc" },
        select: { id: true },
      })
      if (prev) afterRowId = prev.id
      else insertAtTop = true
    }

    let start: number
    let step = 1
    if (insertAtTop) {
      const first = await prisma.sheetRow.findFirst({
        where: { sheetId }, orderBy: { position: "asc" }, select: { position: true },
      })
      // Positions are floats, so going below the current minimum needs no renumber.
      start = (first?.position ?? 0) - count
      step = 1
    } else if (afterRowId) {
      const prev = await prisma.sheetRow.findFirst({
        where: { id: afterRowId, sheetId }, select: { position: true },
      })
      if (!prev) return NextResponse.json({ error: "Baris acuannya nggak ketemu." }, { status: 404 })
      const next = await prisma.sheetRow.findFirst({
        where: { sheetId, position: { gt: prev.position } },
        orderBy: { position: "asc" },
        select: { position: true },
      })
      if (next && next.position - prev.position < MIN_GAP) {
        // Out of room between these two — renumber, then recompute against the fresh positions.
        await renumber(sheetId)
        const p2 = await prisma.sheetRow.findFirst({ where: { id: afterRowId, sheetId }, select: { position: true } })
        const n2 = await prisma.sheetRow.findFirst({
          where: { sheetId, position: { gt: p2?.position ?? 0 } },
          orderBy: { position: "asc" }, select: { position: true },
        })
        start = midpoint(p2?.position ?? 0, n2?.position ?? null)
        step = ((n2?.position ?? (p2?.position ?? 0) + 1) - start) / (count + 1)
      } else {
        start = midpoint(prev.position, next?.position ?? null)
        step = next ? (next.position - start) / (count + 1) : 1
      }
    } else {
      const last = await prisma.sheetRow.findFirst({
        where: { sheetId }, orderBy: { position: "desc" }, select: { position: true },
      })
      start = (last?.position ?? -1) + 1
    }

    const data = Array.from({ length: count }, (_, i) => {
      const cells: Record<string, unknown> = {}
      const src = incoming?.[i]
      if (src) {
        for (const [columnId, raw] of Object.entries(src)) {
          const col = columnsById.get(columnId)
          if (!col) continue
          const v = coerceCellValue(col.type, raw)
          if (v !== null) cells[columnId] = v
        }
      }
      const at = positions && positions.length === count ? positions[i] : start + i * step
      const styles: Record<string, unknown> = {}
      const srcStyles = incomingStyles?.[i]
      if (srcStyles && typeof srcStyles === "object") {
        for (const [columnId, raw] of Object.entries(srcStyles as Record<string, unknown>)) {
          const st = columnsById.has(columnId) ? normalizeCellStyle(raw) : null
          if (st) styles[columnId] = st
        }
      }
      return { sheetId, position: at, cells: cells as object, ...(Object.keys(styles).length ? { styles: styles as object } : {}) }
    })

    // Exactly the rows this request made. Reading back "every row between the lowest and highest
    // new position" also returned the rows already sitting in that span — so undoing a delete of rows
    // 2 and 9 put rows 3–8 into the client cache a second time.
    const created = (await prisma.sheetRow.createManyAndReturn({
      data,
      select: { id: true, position: true, cells: true, styles: true, height: true, updatedAt: true },
    })).sort((a, b) => a.position - b.position)
    emitSheetStructure(sheetId, session.user.id, originTabOf(req))
    return NextResponse.json({
      rows: created.map((r) => ({
        id: r.id, position: r.position, cells: readCells(r.cells), height: r.height, updatedAt: r.updatedAt,
        ...(r.styles ? { styles: readStyles(r.styles) } : {}),
      })),
    }, { status: 201 })
  } catch (error) {
    console.error("Error adding sheet rows:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH — reorder one row: { rowId, afterRowId | null }. null = move to the top.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = (await req.json().catch(() => ({}))) as {
      rowId?: unknown; afterRowId?: unknown; heights?: unknown; order?: unknown
    }

    // Bulk reorder (Data › Sort sheet, sort/randomise by rows, undo of either): { order: rowId[] }.
    // The listed rows trade places among the positions they already hold, so rows NOT listed (a
    // frozen header, rows outside the sorted block) stay exactly where they are.
    if (Array.isArray(body.order)) {
      const order = [...new Set(body.order.filter((x): x is string => typeof x === "string"))]
      if (!order.length) return NextResponse.json({ error: "order kosong." }, { status: 400 })
      if (order.length > 20000) return NextResponse.json({ error: "Kebanyakan baris." }, { status: 422 })
      const found = await prisma.sheetRow.findMany({ where: { id: { in: order }, sheetId }, select: { id: true, position: true } })
      if (found.length !== order.length) return NextResponse.json({ error: "Ada baris yang nggak ketemu." }, { status: 404 })
      const slots = found.map((r) => r.position).sort((a, b) => a - b)
      const blocked = await protectedRowsBlock(session.user.id, access.sheet, order)
      if (blocked) return NextResponse.json({ error: blocked }, { status: 403 })
      await prisma.$executeRaw`
        UPDATE "SheetRow" r SET "position" = v.pos
        FROM (SELECT unnest(${order}::text[]) AS id, unnest(${slots}::float8[]) AS pos) v
        WHERE r."id" = v.id AND r."sheetId" = ${sheetId}
      `
      emitSheetStructure(sheetId, session.user.id, originTabOf(req))
      return NextResponse.json({ ok: true, reordered: order.length })
    }

    // Resize branch. Batched so selecting several rows and dragging once is a single write, and so a
    // single resize is just an array of one. Height is layout, not content — it deliberately does
    // NOT touch `cells`, so the revision trigger never fires for it.
    if (Array.isArray(body.heights)) {
      const items = body.heights
        .map((h) => (h && typeof h === "object" ? (h as { rowId?: unknown; height?: unknown }) : null))
        .filter((h): h is { rowId: unknown; height: unknown } => Boolean(h))
        .map((h) => ({
          rowId: typeof h.rowId === "string" ? h.rowId : "",
          // null clears it back to the default rather than pinning a number.
          height: h.height === null ? null
            : Math.round(Math.max(ROW_HEIGHT_MIN, Math.min(ROW_HEIGHT_MAX, Number(h.height) || ROW_HEIGHT_MIN))),
        }))
        .filter((h) => h.rowId)
      if (!items.length) return NextResponse.json({ error: "heights kosong." }, { status: 400 })
      if (items.length > MAX_ROWS_PER_WRITE) {
        return NextResponse.json({ error: `Maksimal ${MAX_ROWS_PER_WRITE} baris sekali kirim.` }, { status: 422 })
      }
      // sheetId in the WHERE so a rowId borrowed from another sheet matches nothing.
      await prisma.$transaction(items.map((h) =>
        prisma.sheetRow.updateMany({ where: { id: h.rowId, sheetId }, data: { height: h.height } }),
      ))
      emitSheetStructure(sheetId, session.user.id, originTabOf(req))
      return NextResponse.json({ ok: true, resized: items.length })
    }

    const rowId = typeof body.rowId === "string" ? body.rowId : ""
    if (!rowId) return NextResponse.json({ error: "rowId wajib." }, { status: 400 })
    const afterRowId = typeof body.afterRowId === "string" ? body.afterRowId : null

    let position: number
    if (!afterRowId) {
      const first = await prisma.sheetRow.findFirst({
        where: { sheetId }, orderBy: { position: "asc" }, select: { position: true },
      })
      position = (first?.position ?? 0) - 1
    } else {
      const prev = await prisma.sheetRow.findFirst({ where: { id: afterRowId, sheetId }, select: { position: true } })
      if (!prev) return NextResponse.json({ error: "Baris acuannya nggak ketemu." }, { status: 404 })
      const next = await prisma.sheetRow.findFirst({
        where: { sheetId, position: { gt: prev.position }, id: { not: rowId } },
        orderBy: { position: "asc" }, select: { position: true },
      })
      if (next && next.position - prev.position < MIN_GAP) {
        await renumber(sheetId)
        return PATCH(req, { params: Promise.resolve({ sheetId }) })
      }
      position = midpoint(prev.position, next?.position ?? null)
    }

    const updated = await prisma.sheetRow.updateMany({ where: { id: rowId, sheetId }, data: { position } })
    if (!updated.count) return NextResponse.json({ error: "Barisnya nggak ketemu." }, { status: 404 })
    emitSheetStructure(sheetId, session.user.id, originTabOf(req))
    return NextResponse.json({ ok: true, position })
  } catch (error) {
    console.error("Error reordering sheet row:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE — { rowIds: string[] }
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = (await req.json().catch(() => ({}))) as { rowIds?: unknown }
    const rowIds = Array.isArray(body.rowIds) ? body.rowIds.filter((x): x is string => typeof x === "string") : []
    if (!rowIds.length) return NextResponse.json({ error: "rowIds kosong." }, { status: 400 })
    if (rowIds.length > MAX_ROWS_PER_WRITE) {
      return NextResponse.json({ error: `Maksimal ${MAX_ROWS_PER_WRITE} baris sekali hapus.` }, { status: 422 })
    }

    // Scoped by sheetId so a row id from another sheet deletes nothing.
    const ids = (await prisma.sheetRow.findMany({ where: { id: { in: rowIds }, sheetId }, select: { id: true } })).map((r) => r.id)
    if (!ids.length) return NextResponse.json({ deleted: 0 })
    const blocked = await protectedRowsBlock(session.user.id, access.sheet, ids)
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 })
    // In the audit, and kept (with their comments and cell history) first, so Control Room → Audit
    // can put the rows back where they were — all of them or none.
    let count = 0
    const projectId = access.sheet.projectId
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
    // Ranges whose corner row is going away shrink to what's left (SUM(A2:A9) minus row 2 is
    // SUM(A3:A9) — not #REF!), computed against the order BEFORE the delete.
    const rewrite = await shrinkRangesAfterDeletion(sheetId, access.sheet.columns.map((c) => c.id), { rows: new Set(ids) })
    let rewritten: { id: string; cells: unknown; updatedAt: Date }[] = []
    const me = session.user.id
    await restorableDelete({
      entityType: "sheet_rows", entityId: sheetId, rootIds: ids,
      entityName: `${ids.length} ${ids.length === 1 ? "row" : "rows"} of ${access.sheet.name || "a sheet"}`,
      workspaceId: project?.workspaceId ?? null, userId: session.user.id, request: req,
      metadata: { sheetId, sheetName: access.sheet.name, projectId, rows: ids.length },
      meta: { open: { type: "sheet", id: sheetId, projectId }, projectId, sheetId },
      remove: async (tx) => {
        count = (await tx.sheetRow.deleteMany({ where: { id: { in: ids }, sheetId } })).count
        rewritten = await rewrite.apply(tx, me)
      },
    })
    emitSheetStructure(sheetId, session.user.id, originTabOf(req))
    return NextResponse.json({
      deleted: count,
      // Rows whose formulas were rewritten, so the client can patch its cache without a refetch.
      rows: rewritten.map((r) => ({ id: r.id, cells: readCells(r.cells), updatedAt: r.updatedAt })),
    })
  } catch (error) {
    console.error("Error deleting sheet rows:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
