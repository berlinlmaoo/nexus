export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { parseCsv } from "@/lib/csv"
import {
  MAX_COLUMNS, coerceCellValue, normalizeColumns, resolveSheetAccess, safeUrl,
  type SheetColumn, type LinkCell,
} from "@/lib/project-sheets"
import { emitSheetStructure } from "@/lib/socket-emitter"

// POST /api/sheets/[sheetId]/import — multipart { file, mode?: "append" | "replace" }
//
// Accepts .csv and .xlsx. Row 1 is treated as the header row.
//
// Column matching, in order:
//   1. an existing column whose NAME matches the header (case-insensitive)
//   2. otherwise, an existing UNNAMED column at the same position gets named from the header —
//      that's what makes importing into a fresh blank sheet do the obvious thing
//   3. otherwise a new text column is created
//
// Creating columns on import is deliberate, and the opposite of the paste path (which clips): paste
// is an accident-prone reflex, import is an explicit act where growing the sheet is what you meant.
const MAX_IMPORT_ROWS = 5000
const MAX_FILE_BYTES = 10 * 1024 * 1024


/** "F12" -> 5. Only the letters matter; the row is discarded. */
function columnIndexOf(address: string): number {
  const letters = /^[A-Z]+/i.exec(address)?.[0]?.toUpperCase() ?? ""
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * The choices behind an Excel dropdown.
 *
 * Two shapes exist and both are common: an inline literal `"A,B,C"` (what Sheets writes when you type
 * the list into the dialog), and a reference to a range of cells elsewhere in the workbook. Reading
 * only the first would silently lose every dropdown built the second way.
 */
function dropdownOptions(formula: string, wb: ExcelJS.Workbook): string[] {
  const raw = String(formula ?? "").trim()
  if (!raw) return []

  const literal = raw.replace(/^=/, "")
  if (/^"[\s\S]*"$/.test(literal)) {
    return [...new Set(literal.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 100)
  }

  // Range reference: [Sheet!]$A$1:$A$20
  const m = /^=?(?:'([^']+)'|([A-Za-z0-9_ ]+))?!?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(literal)
  if (!m) return []
  const ws = m[1] || m[2] ? wb.getWorksheet(m[1] || m[2]) : wb.worksheets[0]
  if (!ws) return []
  const c1 = columnIndexOf(m[3]) + 1, r1 = Number(m[4])
  const c2 = m[5] ? columnIndexOf(m[5]) + 1 : c1, r2 = m[6] ? Number(m[6]) : r1
  const out: string[] = []
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2) && out.length < 100; r += 1) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c += 1) {
      const v = ws.getCell(r, c).value
      const text = String((v as { text?: unknown })?.text ?? v ?? "").trim()
      if (text) out.push(text)
    }
  }
  return [...new Set(out)]
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const form = await req.formData()
    const file = form.get("file")
    const mode = String(form.get("mode") ?? "append") === "replace" ? "replace" : "append"
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Filenya belum kepilih." }, { status: 422 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File maksimal 10MB." }, { status: 422 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const isXlsx = /\.xlsx$/i.test(file.name) || buf.subarray(0, 2).toString() === "PK"

    /** 0-based column index -> the dropdown choices Excel had on it. */
    const dropdowns = new Map<number, string[]>()
    let grid: (string | number | boolean | Date | LinkCell | null)[][]
    if (isXlsx) {
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf as unknown as ArrayBuffer)
      const ws = wb.worksheets[0]
      if (!ws) return NextResponse.json({ error: "File Excel-nya nggak ada sheet-nya." }, { status: 422 })

      // Excel stores one validation entry PER CELL, so a 1.000-row dropdown is 1.000 identical
      // entries — the first one per column is enough.
      const dvModel = (ws as unknown as { dataValidations?: { model?: Record<string, { type?: string; formulae?: unknown[] }> } }).dataValidations?.model ?? {}
      for (const address of Object.keys(dvModel)) {
        const dv = dvModel[address]
        if (dv?.type !== "list" || !Array.isArray(dv.formulae) || !dv.formulae.length) continue
        const ci = columnIndexOf(address)
        if (ci < 0 || dropdowns.has(ci)) continue
        const opts = dropdownOptions(String(dv.formulae[0]), wb)
        if (opts.length) dropdowns.set(ci, opts)
      }

      grid = []
      ws.eachRow({ includeEmpty: false }, (row) => {
        const values: (string | number | boolean | Date | LinkCell | null)[] = []
        // ExcelJS row.values is 1-indexed with a hole at 0.
        const raw = row.values as unknown[]
        for (let i = 1; i < raw.length; i += 1) {
          const v = raw[i]
          if (v === null || v === undefined) { values.push(null); continue }
          // A cell holding a formula arrives as { formula, result } — take the computed result,
          // because the point of importing is the numbers, not somebody else's formula language.
          if (typeof v === "object" && v !== null && "result" in (v as object)) {
            values.push((v as { result: string | number | boolean | null }).result ?? null)
          } else if (typeof v === "object" && v !== null && "text" in (v as object)) {
            // A hyperlink arrives as { text, hyperlink }. Keeping only the text used to throw the URL
            // away — the one thing in the cell that can't be reconstructed by reading it.
            const cell = v as { text: unknown; hyperlink?: unknown }
            const url = safeUrl(cell.hyperlink)
            const text = String(cell.text ?? "")
            values.push(url ? { t: text || url, u: url } : text)
          } else if (v instanceof Date) values.push(v)
          else values.push(v as string | number | boolean)
        }
        grid.push(values)
      })
    } else {
      grid = parseCsv(buf.toString("utf8"))
    }

    if (!grid.length) return NextResponse.json({ error: "Filenya kosong." }, { status: 422 })
    const header = (grid[0] ?? []).map((h) => String(h ?? "").trim())
    const body = grid.slice(1)
    if (body.length > MAX_IMPORT_ROWS) {
      return NextResponse.json({ error: `Maksimal ${MAX_IMPORT_ROWS} baris sekali import.` }, { status: 422 })
    }

    // ── Resolve the header row to column ids ─────────────────────────────────
    const columns: SheetColumn[] = [...access.sheet.columns]
    const byName = new Map(columns.filter((c) => c.name).map((c) => [c.name.trim().toLowerCase(), c]))
    const targetIds: (string | null)[] = []
    let structureChanged = false

    header.forEach((name, i) => {
      const key = name.toLowerCase()
      const existing = key ? byName.get(key) : undefined
      if (existing) { targetIds.push(existing.id); return }
      // Reuse an unnamed column sitting at this position before inventing a new one — importing into
      // a fresh blank sheet should fill A/B/C, not append a second set of columns beside them.
      const atPos = columns[i]
      if (atPos && !atPos.name.trim()) {
        if (name) { atPos.name = name; structureChanged = true }
        targetIds.push(atPos.id)
        byName.set(key, atPos)
        return
      }
      if (columns.length >= MAX_COLUMNS) { targetIds.push(null); return }
      // No id — normalizeColumns mints it, keeping id generation server-side.
      const created = { name: name || `Kolom ${columns.length + 1}`, type: "text" as const }
      columns.push(created as SheetColumn)
      structureChanged = true
      targetIds.push(null) // filled in after the columns are persisted and have ids
    })

    let finalColumns = columns
    if (structureChanged) {
      const result = normalizeColumns(columns, access.sheet.columns)
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 422 })
      finalColumns = result.columns
      await prisma.projectSheet.update({
        where: { id: sheetId },
        data: { columns: finalColumns as unknown as object },
      })
      // Re-resolve the header now that every column has a real id.
      const nameToId = new Map(finalColumns.filter((c) => c.name).map((c) => [c.name.trim().toLowerCase(), c.id]))
      header.forEach((name, i) => {
        if (targetIds[i]) return
        targetIds[i] = nameToId.get(name.toLowerCase()) ?? finalColumns[i]?.id ?? null
      })
    }

    // A column that arrived carrying hyperlinks is a link column, not text — decided from the data
    // rather than asked, because the file already says so.
    const linkCols = new Set<string>()
    body.forEach((line) => {
      line.forEach((raw, i) => {
        const colId = targetIds[i]
        if (colId && raw && typeof raw === "object" && !(raw instanceof Date) && "u" in raw) linkCols.add(colId)
      })
    })
    // Dropdown columns become "Pilihan" carrying the file's own choices. Same principle as links:
    // the file already says what this column is, so it isn't worth asking.
    const selectOptions = new Map<string, string[]>()
    dropdowns.forEach((opts, ci) => {
      const colId = targetIds[ci]
      if (colId) selectOptions.set(colId, opts)
    })

    if (linkCols.size || selectOptions.size) {
      const retyped = finalColumns.map((c) => {
        if (linkCols.has(c.id) && c.type === "text") return { ...c, type: "link" as const }
        const opts = selectOptions.get(c.id)
        if (opts && c.type === "text") {
          // Merge, don't replace: importing twice into the same column must not drop choices that
          // were already there.
          const merged = [...new Set([...(c.options ?? []), ...opts])].slice(0, 100)
          return { ...c, type: "select" as const, options: merged }
        }
        return c
      })
      const changed = retyped.some((c, i) =>
        c.type !== finalColumns[i].type || (c.options ?? []).length !== (finalColumns[i].options ?? []).length)
      if (changed) {
        finalColumns = retyped
        await prisma.projectSheet.update({
          where: { id: sheetId },
          data: { columns: finalColumns as unknown as object },
        })
      }
    }

    const typeById = new Map(finalColumns.map((c) => [c.id, c.type]))

    if (mode === "replace") await prisma.sheetRow.deleteMany({ where: { sheetId } })

    const last = await prisma.sheetRow.findFirst({
      where: { sheetId }, orderBy: { position: "desc" }, select: { position: true },
    })
    let pos = (last?.position ?? -1) + 1

    const data = body.map((line) => {
      const cells: Record<string, unknown> = {}
      line.forEach((raw, i) => {
        const colId = targetIds[i]
        if (!colId) return
        const value = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw
        const v = coerceCellValue(typeById.get(colId) ?? "text", value)
        if (v !== null) cells[colId] = v
      })
      return { sheetId, position: pos++, cells: cells as object }
    })
    if (data.length) await prisma.sheetRow.createMany({ data })

    logAudit({
      action: "update", entityType: "project_sheet", entityId: sheetId, entityName: access.sheet.name,
      userId: session.user.id, request: req,
      metadata: { imported: data.length, mode, file: file.name, columns: finalColumns.length },
    })

    emitSheetStructure(sheetId, session.user.id)
    return NextResponse.json({
      imported: data.length, columns: finalColumns.length, mode,
      dropdowns: selectOptions.size, links: linkCols.size,
    })
  } catch (error) {
    console.error("Error importing sheet:", error)
    return NextResponse.json({ error: "Filenya nggak kebaca — pastikan .csv atau .xlsx yang valid." }, { status: 422 })
  }
}
