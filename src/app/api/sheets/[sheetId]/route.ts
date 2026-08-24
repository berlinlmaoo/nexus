export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { logAudit } from "@/lib/audit"
import { normalizeColumns, readCells, resolveSheetAccess } from "@/lib/project-sheets"
import { emitSheetStructure } from "@/lib/socket-emitter"

// GET /api/sheets/[sheetId] — the whole sheet: structure + every row.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
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
        select: { id: true, position: true, cells: true, height: true, updatedAt: true },
      }),
    ])

    return NextResponse.json({
      id: sheet.id,
      projectId: sheet.projectId,
      name: sheet.name,
      columns: sheet.columns,
      rows: rows.map((r) => ({ id: r.id, position: r.position, cells: readCells(r.cells), height: r.height, updatedAt: r.updatedAt })),
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

    const body = (await req.json().catch(() => ({}))) as { name?: unknown; columns?: unknown }
    const data: { name?: string; columns?: object } = {}

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
    if (!Object.keys(data).length) return NextResponse.json({ error: "Nggak ada yang diubah." }, { status: 400 })

    const updated = await prisma.projectSheet.update({
      where: { id: sheetId },
      data,
      select: { id: true, name: true, columns: true },
    })
    emitSheetStructure(sheetId, session.user.id)
    return NextResponse.json(updated)
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

    const row = await prisma.projectSheet.findUnique({ where: { id: sheetId }, select: { position: true, name: true } })
    if (row?.position === 0) {
      return NextResponse.json({ error: "Sheet utama nggak bisa dihapus." }, { status: 422 })
    }

    await prisma.projectSheet.delete({ where: { id: sheetId } })
    logAudit({
      action: "delete", entityType: "project_sheet", entityId: sheetId, entityName: row?.name ?? undefined,
      userId: session.user.id, request: req, metadata: { projectId: access.sheet.projectId },
    })
    emitSheetStructure(sheetId, session.user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting sheet:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
