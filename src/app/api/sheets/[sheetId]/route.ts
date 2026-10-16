export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { restorableDelete } from "@/lib/deletion-snapshot"
import {
  SHEET_STRUCTURE_CHANGED, lockSheetStructure, normalizeColumns, protectionChangeBlock, readCells, readSheetSettings, readStyles,
  resolveSheetAccess, type LockedSheet,
} from "@/lib/project-sheets"
import { emitSheetStructure, originTabOf } from "@/lib/socket-emitter"
import { computeSheet } from "@/lib/sheet-formula"

// GET /api/sheets/[sheetId] — the whole sheet: structure + every row.
//
// ?computed=1 adds `computed`: { [rowId]: { [columnId]: { v, d, nf?, formula?, error? } } } for every
// non-empty cell — the computed value (formula results evaluated; numbers, dates as serials since
// 1899-12-30, text, booleans or an error text like "#REF!") and `d`, the exact text the web grid
// shows. Mobile apps render sheets from this without a formula engine of their own; export uses the
// same function, so a phone, the grid and the .xlsx can never disagree.
export async function GET(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["VIEWER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })
    const { sheet } = access

    // Rights are resolved here, not in the client — a hidden button is not authorization, and the
    // client shouldn't have to re-derive role rules that live in rbac.ts.
    const [{ allowed: canEdit }, { allowed: canManage }, rows] = await Promise.all([
      checkProjectAccess(session.user.id, sheet.projectId, ["MEMBER"]),
      checkProjectAccess(session.user.id, sheet.projectId, ["LEAD"]),
      prisma.sheetRow.findMany({
        where: { sheetId },
        orderBy: { position: "asc" },
        select: { id: true, position: true, cells: true, styles: true, height: true, updatedAt: true },
      }),
    ])

    // `styles` (per-cell formatting) only when a row has any, so unformatted sheets stay as small as before.
    const outRows = rows.map((r) => ({
      id: r.id, position: r.position, cells: readCells(r.cells), height: r.height, updatedAt: r.updatedAt,
      ...(r.styles ? { styles: readStyles(r.styles) } : {}),
    }))
    const wantComputed = ["1", "true"].includes(req.nextUrl.searchParams.get("computed") ?? "")
    return NextResponse.json({
      id: sheet.id,
      projectId: sheet.projectId,
      name: sheet.name,
      columns: sheet.columns,
      // What a structure PATCH sends back as `structureVersion` (race audit 16 Oct 2026, H6).
      structureVersion: sheet.structureVersion,
      // Freeze, hidden rows/columns, merges, tab colour — the same for everyone looking at the sheet.
      settings: sheet.settings,
      rows: outRows,
      ...(wantComputed ? { computed: computeSheet(sheet.columns, outRows, { names: sheet.settings.namedRanges }) } : {}),
      canEdit,
      canManage,
    })
  } catch (error) {
    console.error("Error reading sheet:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH — STRUCTURE only ({ name?, columns?, settings?, structureVersion? }). Cell values go through /cells.
//
// Concurrency (race audit 16 Oct 2026, H6): the sheet row is locked (SELECT … FOR UPDATE) and re-read, and
// everything below is computed from THAT copy, so two writes in the same moment both land:
//   - settings merge per key onto what is stored now ({ frozenRows: 2 } and { hiddenRows: […] } at once keep both);
//   - `columns` is the whole list. With `structureVersion` (the version the client last saw: GET and every PATCH
//     answer it) a list based on an older version is refused with 409 SHEET_STRUCTURE_CHANGED + the current
//     structure, instead of silently dropping a column someone else just added. Without it (apps from before
//     16 Oct 2026) the list is accepted, columns it did not know about are put back at their place, and a
//     column someone deleted meanwhile is not brought back.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { sheetId } = await params

    const access = await resolveSheetAccess(userId, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = (await req.json().catch(() => ({}))) as { name?: unknown; columns?: unknown; settings?: unknown; structureVersion?: unknown }
    const base = typeof body.structureVersion === "number" && Number.isInteger(body.structureVersion) ? body.structureVersion : null

    let name: string | undefined
    if (typeof body.name === "string") {
      name = body.name.trim().slice(0, 80)
      if (!name) return NextResponse.json({ error: "Nama sheet nggak boleh kosong." }, { status: 422 })
    }
    const settingsPatch = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
      ? (body.settings as Record<string, unknown>) : null
    if (name === undefined && body.columns === undefined && !settingsPatch) {
      return NextResponse.json({ error: "Nggak ada yang diubah." }, { status: 400 })
    }

    type Out =
      | { kind: "ok"; row: { id: string; name: string; columns: unknown; settings: unknown; structureVersion: number } }
      | { kind: "error"; status: number; body: Record<string, unknown> }
    const out: Out = await prisma.$transaction(async (tx): Promise<Out> => {
      const fresh: LockedSheet | null = await lockSheetStructure(tx, sheetId)
      if (!fresh) return { kind: "error", status: 404, body: { error: "Sheet-nya nggak ketemu." } }
      const data: { name?: string; columns?: object; settings?: object; structureVersion?: { increment: number } } = {}
      if (name !== undefined) data.name = name
      if (body.columns !== undefined) {
        if (base !== null && base !== fresh.structureVersion) {
          return {
            kind: "error", status: 409,
            body: { ...SHEET_STRUCTURE_CHANGED, current: { columns: fresh.columns, settings: fresh.settings, structureVersion: fresh.structureVersion, name: fresh.name } },
          }
        }
        // Without a version: ids in the body the sheet no longer has that were DELETED (a restorable column
        // delete) are a stale copy, not new columns — they must not come back. Read under the lock, so a delete
        // that committed while this request waited for it is seen.
        let dropIds: Set<string> | undefined
        if (base === null && Array.isArray(body.columns)) {
          const unknownIds = (body.columns as { id?: unknown }[])
            .map((c) => (c && typeof c.id === "string" ? c.id : null))
            .filter((id): id is string => !!id && !fresh.columns.some((c) => c.id === id))
          if (unknownIds.length) {
            const gone = await tx.deletionSnapshot.findMany({
              where: { entityType: "project_sheet_column", entityId: { in: unknownIds.map((id) => `${sheetId}:${id}`) }, restoredAt: null },
              select: { entityId: true },
            })
            dropIds = new Set(gone.map((g) => g.entityId.slice(sheetId.length + 1)))
          }
        }
        const result = normalizeColumns(body.columns, fresh.columns, base === null ? { keepMissing: true, dropIds } : {})
        if ("error" in result) return { kind: "error", status: 422, body: { error: result.error } }
        if (JSON.stringify(result.columns) !== JSON.stringify(fresh.columns)) {
          data.columns = result.columns as unknown as object
          data.structureVersion = { increment: 1 }
        }
      }
      // Settings merge per key: { frozenRows: 2 } leaves the merges alone; a key set to null clears it.
      if (settingsPatch) {
        const merged: Record<string, unknown> = { ...fresh.settings }
        for (const [k, v] of Object.entries(settingsPatch)) {
          if (v === null) delete merged[k]
          else merged[k] = v
        }
        const next = readSheetSettings(merged)
        // New protections are stamped with their creator; nobody can forge `by` for someone else.
        for (const p of next.protections ?? []) {
          const old = (fresh.settings.protections ?? []).find((x) => x.id === p.id)
          p.by = old?.by ?? userId
        }
        const blocked = await protectionChangeBlock(userId, { ...access.sheet, settings: fresh.settings }, next)
        if (blocked) return { kind: "error", status: 403, body: { error: blocked } }
        data.settings = next as object
      }
      const row = await tx.projectSheet.update({
        where: { id: sheetId },
        data,
        select: { id: true, name: true, columns: true, settings: true, structureVersion: true },
      })
      return { kind: "ok", row }
    })
    if (out.kind === "error") return NextResponse.json(out.body, { status: out.status })
    emitSheetStructure(sheetId, userId, originTabOf(req))
    return NextResponse.json({ ...out.row, settings: readSheetSettings(out.row.settings) })
  } catch (error) {
    console.error("Error updating sheet:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE — LEAD only, and never the default sheet (the tab must always have something to show).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["LEAD"])
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.status === 403 ? "Cuma lead/manager ke atas yang boleh hapus sheet." : access.error },
        { status: access.status },
      )
    }

    const row = await prisma.projectSheet.findUnique({ where: { id: sheetId }, select: { position: true, name: true, project: { select: { workspaceId: true } } } })
    if (row?.position === 0) {
      return NextResponse.json({ error: "Sheet utama nggak bisa dihapus." }, { status: 422 })
    }

    // Kept with its rows, comments and cell history first, so Control Room → Audit can restore it.
    const projectId = access.sheet.projectId
    await restorableDelete({
      entityType: "project_sheet", entityId: sheetId, entityName: row?.name ?? access.sheet.name,
      workspaceId: row?.project.workspaceId ?? null, userId: session.user.id, request: req,
      metadata: { projectId },
      meta: { open: { type: "sheet", id: sheetId, projectId }, projectId, sheetId },
      remove: (tx) => tx.projectSheet.delete({ where: { id: sheetId } }),
    })
    emitSheetStructure(sheetId, session.user.id, originTabOf(req))
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting sheet:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
