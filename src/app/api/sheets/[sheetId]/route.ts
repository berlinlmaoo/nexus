export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { normalizeColumns, protectionChangeBlock, readCells, readSheetSettings, readStyles, resolveSheetAccess } from "@/lib/project-sheets"
import { emitSheetStructure } from "@/lib/socket-emitter"
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

// PATCH — STRUCTURE only ({ name?, columns? }). Cell values go through /cells.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = (await req.json().catch(() => ({}))) as { name?: unknown; columns?: unknown; settings?: unknown }
    const data: { name?: string; columns?: object; settings?: object } = {}

    if (typeof body.name === "string") {
      const name = body.name.trim().slice(0, 80)
      if (!name) return NextResponse.json({ error: "Nama sheet nggak boleh kosong." }, { status: 422 })
      data.name = name
    }
    if (body.columns !== undefined) {
      const result = normalizeColumns(body.columns, access.sheet.columns)
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 422 })
      data.columns = result.columns as unknown as object
    }
    // Settings merge per key: { frozenRows: 2 } leaves the merges alone; a key set to null clears it.
    if (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)) {
      const merged: Record<string, unknown> = { ...access.sheet.settings }
      for (const [k, v] of Object.entries(body.settings as Record<string, unknown>)) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }
      const next = readSheetSettings(merged)
      // New protections are stamped with their creator; nobody can forge `by` for someone else.
      for (const p of next.protections ?? []) {
        const old = (access.sheet.settings.protections ?? []).find((x) => x.id === p.id)
        p.by = old?.by ?? session.user.id
      }
      const blocked = await protectionChangeBlock(session.user.id, access.sheet, next)
      if (blocked) return NextResponse.json({ error: blocked }, { status: 403 })
      data.settings = next as object
    }
    if (!Object.keys(data).length) return NextResponse.json({ error: "Nggak ada yang diubah." }, { status: 400 })

    const updated = await prisma.projectSheet.update({
      where: { id: sheetId },
      data,
      select: { id: true, name: true, columns: true, settings: true },
    })
    emitSheetStructure(sheetId, session.user.id)
    return NextResponse.json({ ...updated, settings: readSheetSettings(updated.settings) })
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
    emitSheetStructure(sheetId, session.user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting sheet:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
