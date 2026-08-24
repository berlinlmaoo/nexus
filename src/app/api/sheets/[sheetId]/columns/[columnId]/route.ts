export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { resolveSheetAccess } from "@/lib/project-sheets"
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

    await prisma.$transaction([
      prisma.projectSheet.update({
        where: { id: sheetId },
        data: { columns: access.sheet.columns.filter((c) => c.id !== columnId) as unknown as object },
      }),
      // Drop the key from every row in one statement — otherwise the values linger as orphans that
      // would silently reappear if a future column ever reused the id.
      prisma.$executeRaw`UPDATE "SheetRow" SET "cells" = "cells" - ${columnId} WHERE "sheetId" = ${sheetId}`,
    ])

    logAudit({
      action: "delete", entityType: "project_sheet_column", entityId: `${sheetId}:${columnId}`,
      entityName: column.name, userId: session.user.id, request: req,
      metadata: { sheetId, projectId: access.sheet.projectId },
    })
    emitSheetStructure(sheetId, session.user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting sheet column:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
