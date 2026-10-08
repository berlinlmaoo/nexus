export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { MAX_COLUMNS, resolveSheetAccess } from "@/lib/project-sheets"
import { deleteColumnKeepingSnapshot } from "@/lib/deletion-snapshot"
import { emitSheetStructure } from "@/lib/socket-emitter"

// DELETE /api/sheets/[sheetId]/columns/[columnId]
//
// LEAD only. Deleting a column destroys everyone's values in it and v1 has no revision history, so
// this is one of the two actions a staff member can't do (the other is deleting a sheet).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sheetId: string; columnId: string }> },
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId, columnId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["LEAD"])
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.status === 403 ? "Cuma lead/manager ke atas yang boleh hapus kolom." : access.error },
        { status: access.status },
      )
    }

    const column = access.sheet.columns.find((c) => c.id === columnId)
    if (!column) return NextResponse.json({ error: "Kolomnya nggak ketemu." }, { status: 404 })
    if (access.sheet.columns.length <= 1) {
      return NextResponse.json({ error: "Sheet harus punya minimal satu kolom." }, { status: 422 })
    }

    // The column's definition, its place and every row's value are kept first, so Control Room → Audit
    // can put the column back (values return to the rows that still exist).
    const projectId = access.sheet.projectId
    const auditLogId = await logAudit({
      action: "delete", entityType: "project_sheet_column", entityId: `${sheetId}:${columnId}`,
      entityName: column.name || "Untitled column", userId: session.user.id, request: req,
      metadata: { sheetId, sheetName: access.sheet.name, projectId },
    })
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
    await deleteColumnKeepingSnapshot({
      entityType: "project_sheet_column", entityId: `${sheetId}:${columnId}`, entityName: column.name || "Untitled column",
      workspaceId: project?.workspaceId ?? null, deletedById: session.user.id, auditLogId,
      sheetId, columnId, maxColumns: MAX_COLUMNS,
      meta: { open: { type: "sheet", id: sheetId, projectId }, projectId, sheetId },
      remove: async (tx) => {
        await tx.projectSheet.update({
          where: { id: sheetId },
          data: { columns: access.sheet.columns.filter((c) => c.id !== columnId) as unknown as object },
        })
        // Drop the key from every row in one statement — otherwise the values linger as orphans that
        // would silently reappear if a future column ever reused the id.
        await tx.$executeRaw`UPDATE "SheetRow" SET "cells" = "cells" - ${columnId} WHERE "sheetId" = ${sheetId}`
      },
    })
    emitSheetStructure(sheetId, session.user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting sheet column:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
