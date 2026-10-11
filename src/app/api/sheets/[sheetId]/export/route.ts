export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { toCsv } from "@/lib/csv"
import { isLinkCell, readCells, readStyles, resolveSheetAccess, type CellStyle, type SheetColumn, type StyleColor } from "@/lib/project-sheets"
import { computeSheet, serialToIso, serialToYmd, type CellValue, type ComputedCell } from "@/lib/sheet-formula"

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

/** The grid's palette as Excel colours: [text, fill]. */
const XLSX_COLOR: Record<StyleColor, [string, string]> = {
  red: ["FFDC2626", "FFFEE2E2"], orange: ["FFEA580C", "FFFFEDD5"], amber: ["FFD97706", "FFFEF3C7"],
  green: ["FF16A34A", "FFDCFCE7"], teal: ["FF0D9488", "FFCCFBF1"], blue: ["FF2563EB", "FFDBEAFE"],
  violet: ["FF7C3AED", "FFEDE9FE"], pink: ["FFDB2777", "FFFCE7F3"], slate: ["FF475569", "FFE2E8F0"],
  black: ["FF111827", "FF9CA3AF"],
}

/** One cell's NEXUS formatting onto an ExcelJS cell, so the .xlsx looks like the grid. */
function applyStyle(cell: ExcelJS.Cell, st: CellStyle) {
  if (st.b || st.i || st.s || st.u || st.fc || st.fs) {
    cell.font = {
      ...(cell.font ?? {}),
      ...(st.b ? { bold: true } : {}), ...(st.i ? { italic: true } : {}), ...(st.s ? { strike: true } : {}),
      ...(st.u ? { underline: true } : {}), ...(st.fc ? { color: { argb: XLSX_COLOR[st.fc][0] } } : {}),
      ...(st.fs ? { size: Math.round(st.fs * 0.75) } : {}),
    }
  }
  if (st.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLSX_COLOR[st.bg][1] } }
  if (st.ha || st.va || st.w) {
    cell.alignment = {
      ...(st.ha ? { horizontal: st.ha === "l" ? "left" : st.ha === "c" ? "center" : "right" } : {}),
      ...(st.va ? { vertical: st.va === "t" ? "top" : st.va === "m" ? "middle" : "bottom" } : {}),
      ...(st.w ? { wrapText: true } : {}),
    }
  }
  if (st.bd) {
    const side = { style: "thin" as const, color: { argb: "FF111827" } }
    cell.border = {
      ...(st.bd.includes("t") ? { top: side } : {}), ...(st.bd.includes("b") ? { bottom: side } : {}),
      ...(st.bd.includes("l") ? { left: side } : {}), ...(st.bd.includes("r") ? { right: side } : {}),
    }
  }
}

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
      select: { id: true, cells: true, styles: true },
    })
    const format = (req.nextUrl.searchParams.get("format") ?? "csv").toLowerCase()
    const project = await prisma.project.findUnique({ where: { id: sheet.projectId }, select: { name: true } })
    const base = safeFileName(`${project?.name ?? "Project"} - ${sheet.name}`)

    // Trailing rows nobody ever typed in are seeded blanks, not data — exporting 40 empty lines is
    // noise in Excel. Blank rows in the MIDDLE are kept, because there they're deliberate spacing.
    const cellRows = rows.map((r) => ({ id: r.id, cells: readCells(r.cells) as Record<string, unknown>, styles: readStyles(r.styles) }))
    let last = cellRows.length - 1
    while (last >= 0 && Object.keys(cellRows[last].cells).length === 0) last -= 1
    const body = cellRows.slice(0, last + 1)

    // The SAME computation GET ?computed=1 serves, over the WHOLE sheet with its real row ids — the
    // old export evaluated with positions as row ids, so every formula with a reference was #REF!.
    const computed = computeSheet(sheet.columns, cellRows)
    const cellAt = (rowIndex: number, colId: string): ComputedCell | undefined => computed[body[rowIndex]?.id]?.[colId]
    const linkAt = (rowIndex: number, colId: string): string => {
      const raw = body[rowIndex]?.cells[colId]
      return isLinkCell(raw) ? raw.u : ""
    }
    /** CSV: numbers stay numbers (no "Rp", so Excel can sum), dates ISO, percent as typed. */
    const csvValue = (c: ComputedCell | undefined): CellValue => {
      if (!c) return ""
      if (typeof c.v === "number") {
        if (c.nf === "date") return serialToIso(c.v)
        if (c.nf === "pct") return c.d
        return c.v
      }
      if (typeof c.v === "boolean") return c.v ? "TRUE" : "FALSE"
      return c.v ?? ""
    }

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(safeFileName(sheet.name).slice(0, 31) || "Sheet1")
      ws.addRow(sheet.columns.map(headerOf))
      ws.getRow(1).font = { bold: true }

      body.forEach((_r, i) => {
        const row = ws.addRow(sheet.columns.map((c) => {
          const cell = cellAt(i, c.id)
          if (!cell) return null
          // Dates go in as real dates, so Excel can sort and add to them.
          if (typeof cell.v === "number" && cell.nf === "date") {
            const { y, m, d } = serialToYmd(cell.v)
            return new Date(Date.UTC(y, m - 1, d))
          }
          return cell.v
        }))
        // Formats a single cell carries (a Rupiah or percent typed into a text column, a formula
        // that returns a date) go on that cell; whole-column formats are set below.
        sheet.columns.forEach((c, ci) => {
          const cell = cellAt(i, c.id)
          const st = body[i]?.styles?.[c.id]
          if (st) applyStyle(row.getCell(ci + 1), st)
          if (typeof cell?.v !== "number") return
          // The cell's own number format (toolbar) wins over the detected one.
          const kind = st?.nf ?? cell.nf
          const dec = st?.dp !== undefined ? (st.dp ? `.${"0".repeat(st.dp)}` : "") : null
          const fmt = kind === "idr" ? `"Rp" #,##0${dec ?? ""}` : kind === "pct" ? `0${dec ?? ".##"}%` : kind === "date" ? "dd/mm/yyyy"
            : kind === "num" || dec !== null ? `#,##0${dec ?? ".##"}` : null
          if (fmt) row.getCell(ci + 1).numFmt = fmt
        })
        // Real Excel hyperlinks, so a link column opens in Excel exactly like it does in the grid.
        sheet.columns.forEach((c, ci) => {
          const url = linkAt(i, c.id)
          if (!url) return
          const cell = row.getCell(ci + 1)
          cell.value = { text: String(cellAt(i, c.id)?.d || url), hyperlink: url }
          cell.font = { color: { argb: "FF1155CC" }, underline: true }
        })
      })
      const settings = sheet.settings
      sheet.columns.forEach((c, i) => {
        const col = ws.getColumn(i + 1)
        col.width = Math.min(40, Math.max(10, Math.round((c.width ?? 140) / 7)))
        if (c.type === "currency") col.numFmt = '"Rp" #,##0'
        if (c.type === "date") col.numFmt = "dd/mm/yyyy"
        if (settings.hiddenCols?.includes(c.id)) col.hidden = true
      })
      // Hidden rows, merged cells and frozen panes travel too (row 1 of the file is the header).
      const rowIndex = new Map(body.map((r, i) => [r.id, i]))
      for (const id of settings.hiddenRows ?? []) {
        const i = rowIndex.get(id)
        if (i !== undefined) ws.getRow(i + 2).hidden = true
      }
      for (const m of settings.merges ?? []) {
        const r = rowIndex.get(m.r)
        const c = sheet.columns.findIndex((x) => x.id === m.c)
        if (r === undefined || c < 0) continue
        try { ws.mergeCells(r + 2, c + 1, Math.min(body.length, r + m.rs) + 1, Math.min(sheet.columns.length, c + m.cs)) } catch { /* overlapping merge */ }
      }
      ws.views = [{ state: "frozen", ySplit: 1 + (settings.frozenRows ?? 0), xSplit: settings.frozenCols ?? 0 }]

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
      ...body.map((_r, i) => {
        const line: CellValue[] = []
        sheet.columns.forEach((c) => {
          line.push(csvValue(cellAt(i, c.id)))
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
