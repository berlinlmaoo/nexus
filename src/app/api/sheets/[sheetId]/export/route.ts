export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { toCsv } from "@/lib/csv"
import { isLinkCell, readCells, resolveSheetAccess, type SheetColumn } from "@/lib/project-sheets"
import { evaluateCell, isFormulaCell, type CellValue, type SheetData } from "@/lib/sheet-formula"

// GET /api/sheets/[sheetId]/export?format=csv|xlsx
//
// The column LETTER is only a display convention (columns are stored by id), so the export writes
// the column NAME as the header, falling back to the letter for columns nobody has named yet.
function colLetter(i: number): string {
  let n = i
  let out = ""
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return out
}
const headerOf = (c: SheetColumn, i: number) => c.name?.trim() || colLetter(i)

const safeFileName = (s: string) => s.replace(/[^\w\s.-]+/g, "_").trim().slice(0, 80) || "sheet"

export async function GET(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["VIEWER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })
    const { sheet } = access

    const rows = await prisma.sheetRow.findMany({
      where: { sheetId },
      orderBy: { position: "asc" },
      select: { cells: true },
    })
    const format = (req.nextUrl.searchParams.get("format") ?? "csv").toLowerCase()
    const project = await prisma.project.findUnique({ where: { id: sheet.projectId }, select: { name: true } })
    const base = safeFileName(`${project?.name ?? "Project"} - ${sheet.name}`)

    // Trailing rows nobody ever typed in are seeded blanks, not data — exporting 40 empty lines is
    // noise in Excel. Blank rows in the MIDDLE are kept, because there they're deliberate spacing.
    const cellRows = rows.map((r) => readCells(r.cells))
    let last = cellRows.length - 1
    while (last >= 0 && Object.keys(cellRows[last]).length === 0) last -= 1
    const body = cellRows.slice(0, last + 1)

    // Formulas are never stored with a cached result, so the export has to run the same engine the
    // browser runs — that's why it's a mirrored file rather than client-only.
    const data: SheetData = {
      shape: { columnIds: sheet.columns.map((c) => c.id), rowIds: rows.map((_, i) => String(i)) },
      cells: new Map(cellRows.map((cells, i) => [String(i), cells as Record<string, unknown>])),
    }
    const valueAt = (rowIndex: number, colId: string): CellValue => {
      const raw = cellRows[rowIndex]?.[colId]
      // A link exports as its LABEL — that's what the column reads as. The URL goes with it via the
      // real hyperlink in xlsx, and as a second value in CSV (see linkAt), so nothing is lost.
      if (Array.isArray(raw)) return raw.join(", ")
      if (isLinkCell(raw)) return raw.t || raw.u
      if (!isFormulaCell(raw)) return (raw ?? null) as CellValue
      return evaluateCell(data, String(rowIndex), colId)
    }
    const linkAt = (rowIndex: number, colId: string): string => {
      const raw = cellRows[rowIndex]?.[colId]
      return isLinkCell(raw) ? raw.u : ""
    }

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(safeFileName(sheet.name).slice(0, 31) || "Sheet1")
      ws.addRow(sheet.columns.map(headerOf))
      ws.getRow(1).font = { bold: true }
      // Freeze the header, matching what the grid does on screen.
      ws.views = [{ state: "frozen", ySplit: 1 }]

      body.forEach((_cells, i) => {
        const row = ws.addRow(sheet.columns.map((c) => valueAt(i, c.id)))
        // Real Excel hyperlinks, so a link column opens in Excel exactly like it does in the grid.
        sheet.columns.forEach((c, ci) => {
          const url = linkAt(i, c.id)
          if (!url) return
          const cell = row.getCell(ci + 1)
          cell.value = { text: String(cell.value ?? url), hyperlink: url }
          cell.font = { color: { argb: "FF1155CC" }, underline: true }
        })
      })
      sheet.columns.forEach((c, i) => {
        const col = ws.getColumn(i + 1)
        col.width = Math.min(40, Math.max(10, Math.round((c.width ?? 140) / 7)))
        if (c.type === "currency") col.numFmt = '#,##0'
        if (c.type === "date") col.numFmt = "dd/mm/yyyy"
      })

      const buf = await wb.xlsx.writeBuffer()
      return new NextResponse(buf as ArrayBuffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        },
      })
    }

    // CSV — values go through csvCell, which neutralizes formula injection. Numbers stay numbers so a
    // genuinely negative amount isn't mistaken for an injection and prefixed with an apostrophe.
    // CSV has nowhere to hang a hyperlink, so every link column exports as two: the label, then
    // "<name> (URL)". Dropping the address silently would be the worse trade.
    const csvHeader: string[] = []
    sheet.columns.forEach((c, i) => {
      csvHeader.push(headerOf(c, i))
      if (c.type === "link") csvHeader.push(`${headerOf(c, i)} (URL)`)
    })
    const csv = toCsv([
      csvHeader,
      ...body.map((_cells, i) => {
        const line: CellValue[] = []
        sheet.columns.forEach((c) => {
          line.push(valueAt(i, c.id) ?? "")
          if (c.type === "link") line.push(linkAt(i, c.id))
        })
        return line
      }),
    ])
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    })
  } catch (error) {
    console.error("Error exporting sheet:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
