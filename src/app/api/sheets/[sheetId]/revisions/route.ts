export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { resolveSheetAccess } from "@/lib/project-sheets"

const CELL_LIMIT = 50
const SHEET_LIMIT = 100

// GET /api/sheets/[sheetId]/revisions
//   ?rowId=&columnId=  → history for ONE cell (what the cell popover shows)
//   (no params)        → the sheet's recent activity, newest first
//
// Read-only. The rows themselves are written by the `sheet_row_revisions` Postgres trigger, never
// from here — see prisma/migrations/manual/2026-08-04-sheet-revisions.sql for why.
export async function GET(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["VIEWER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const rowId = (req.nextUrl.searchParams.get("rowId") ?? "").trim()
    const columnId = (req.nextUrl.searchParams.get("columnId") ?? "").trim()
    const perCell = Boolean(rowId && columnId)

    const revisions = await prisma.sheetCellRevision.findMany({
      where: perCell ? { sheetId, rowId, columnId } : { sheetId },
      orderBy: { createdAt: "desc" },
      take: perCell ? CELL_LIMIT : SHEET_LIMIT,
      select: {
        id: true, rowId: true, columnId: true, oldValue: true, newValue: true, createdAt: true,
        author: { select: { id: true, name: true, avatar: true } },
      },
    })

    // A revision on a since-deleted column would render against a column that no longer exists, so
    // it's dropped here rather than shown floating — same rule the comments endpoint follows.
    const live = new Set(access.sheet.columns.map((c) => c.id))
    return NextResponse.json({ revisions: revisions.filter((r) => live.has(r.columnId)) })
  } catch (error) {
    console.error("Error listing sheet revisions:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
