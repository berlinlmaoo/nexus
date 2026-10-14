import ExcelJS from "exceljs"
import type { HealthKey } from "@/lib/pipeline"
import type { SerializedDeal } from "@/lib/pipeline-server"

/**
 * The Pipeline Dashboard's "Download Excel" workbook (owner + GM, 14 Oct 2026: "benerin dan rapihin").
 *
 * Sheet 1 "Master Project" is the GM's export, column for column: his 33 headers in his order (Indonesian, or
 * their English equivalents with ?lang=en), header on row 1, so a NEXUS file and a Control Tower file
 * merge row for row; a 34th column at the very end, "Diperbarui Oleh", keeps the last editor the earlier
 * export carried. Values are real numbers, percentages and dates (not text) with Rupiah / % / date
 * formats; negative margin and cash read red through the number format. Sheet 2 lists every payment term
 * (NEXUS has terms, the Control Tower had none, so they live beside the master sheet, not in it); a deal
 * without terms that has the manual payment due date gets one row there too, marked as that date. Sheet 3
 * "Info" says which board, when (WIB), by whom, and how the numbers are counted.
 *
 * Stored values (stage, statuses) stay the keys everyone already uses in the sheet, in both languages.
 */

export type ExportLang = "id" | "en"

const HEALTH: Record<HealthKey, [string, string]> = {
  CRITICAL: ["Kritis", "Critical"],
  ATTENTION: ["Perhatian", "Attention"],
  HEALTHY: ["Sehat", "Healthy"],
  NOT_STARTED: ["Belum Mulai", "Not Started"],
  NONE: ["—", "—"],
}

type Kind = "text" | "wrap" | "money" | "moneySigned" | "pct" | "pct1" | "int" | "date" | "datetime"
type Col = { id: string; en: string; width: number; kind: Kind; value: (d: SerializedDeal, lang: ExportLang) => unknown }

const MONEY_FMT = '"Rp"#,##0;-"Rp"#,##0'
const MONEY_SIGNED_FMT = '"Rp"#,##0;[Red]-"Rp"#,##0'
const PCT_FMT = "0%"
const PCT1_FMT = "0.0%;[Red]-0.0%"
const DATE_FMT = "dd mmm yyyy"
const DATETIME_FMT = "dd mmm yyyy hh:mm"

/** "YYYY-MM-DD" → a date cell (midnight, no zone: Excel dates have none). */
function day(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** An instant → the company's wall clock (WIB) as a date cell; the Info sheet says the zone. */
export function wib(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime()
  return Number.isFinite(t) ? new Date(t + 7 * 3600_000) : null
}

/** "label: 1.500.000", one line per cost (the GM's "Rincian Real Cost"). */
export function costLines(costs: readonly { label: string; amount: number }[]): string {
  return costs.map((c) => `${c.label || "-"}: ${Math.round(c.amount).toLocaleString("id-ID")}`).join("\n")
}

function linksText(d: SerializedDeal): string {
  return d.links
    .map((l) => `${l.type}: ${l.kind === "file" ? (l.label ? `${l.label} (${l.fileName})` : l.fileName) : l.label ? `${l.label} (${l.url})` : l.url}`)
    .join("\n")
}

/** The margin cells: blank without cost lines (like the board) or without a net value (lib/pipeline.ts marginOf). */
function marginCell(d: SerializedDeal, key: "margin" | "marginPct"): number | null {
  return d.costs.length > 0 ? d[key] : null
}

/**
 * The GM's 33 columns, in his order, then "Diperbarui Oleh" (34). Payment status / receivable come from the
 * terms when a deal has any.
 */
export const MASTER_COLUMNS: Col[] = [
  { id: "Project ID", en: "Project ID", width: 12, kind: "text", value: (d) => d.code },
  { id: "Nama Project", en: "Project Name", width: 34, kind: "wrap", value: (d) => d.name },
  { id: "Brand/Client", en: "Brand/Client", width: 18, kind: "text", value: (d) => d.brand },
  { id: "Service", en: "Service", width: 20, kind: "text", value: (d) => d.services.join(", ") },
  { id: "BD", en: "BD", width: 16, kind: "text", value: (d) => d.bd?.name ?? d.bdName ?? "" },
  { id: "PM", en: "PM", width: 16, kind: "text", value: (d) => d.pm?.name ?? d.pmName ?? "" },
  { id: "Fase Pipeline", en: "Pipeline Phase", width: 22, kind: "text", value: (d) => d.stage },
  { id: "Probabilitas", en: "Probability", width: 12, kind: "pct", value: (d) => d.probability },
  { id: "Nilai Kontrak", en: "Contract Value", width: 17, kind: "money", value: (d) => d.contractValue },
  { id: "Nilai Bersih Project", en: "Net Project Value", width: 19, kind: "money", value: (d) => d.netValue },
  { id: "Nilai Invoice", en: "Invoice Value", width: 17, kind: "money", value: (d) => d.invoiceValue },
  { id: "Status Kontrak", en: "Contract Status", width: 18, kind: "text", value: (d) => d.contractStatus },
  { id: "Status Vendor Registration", en: "Vendor Registration Status", width: 22, kind: "text", value: (d) => d.vregStatus },
  { id: "Execution Readiness", en: "Execution Readiness", width: 14, kind: "text", value: (d) => d.readiness },
  { id: "Status Deliverable", en: "Deliverable Status", width: 18, kind: "text", value: (d) => d.deliverableStatus },
  { id: "Risiko Deliverable", en: "Deliverable Risk", width: 14, kind: "text", value: (d) => d.deliverableRisk },
  { id: "Status Pembayaran", en: "Payment Status", width: 15, kind: "text", value: (d) => d.termSummary?.paymentStatus ?? d.paymentStatus },
  { id: "Piutang Outstanding", en: "Outstanding Receivable", width: 18, kind: "money", value: (d) => d.termSummary?.outstanding ?? d.outstandingReceivable },
  { id: "Hari Overdue Maks", en: "Max Days Overdue", width: 11, kind: "int", value: (d) => d.daysOverdue },
  { id: "Posisi Kas Bersih", en: "Net Cash Position", width: 18, kind: "moneySigned", value: (d) => d.netCash },
  { id: "Status Closing", en: "Closing Status", width: 22, kind: "text", value: (d) => d.closingStatus },
  { id: "Total Real Cost", en: "Total Real Cost", width: 17, kind: "money", value: (d) => d.costTotal },
  // Blank while the deal has no cost lines or no net value: no cost data is not a 100% margin, and a
  // margin of nothing is not one either (owner, 14 Oct 2026; the board shows a margin only with costs).
  { id: "Margin (Rp)", en: "Margin (Rp)", width: 17, kind: "moneySigned", value: (d) => marginCell(d, "margin") },
  { id: "Margin (%)", en: "Margin (%)", width: 11, kind: "pct1", value: (d) => marginCell(d, "marginPct") },
  { id: "Project Health", en: "Project Health", width: 13, kind: "text", value: (d, lang) => HEALTH[d.health.key][lang === "en" ? 1 : 0] },
  { id: "Tanggal Event", en: "Event Date", width: 13, kind: "date", value: (d) => day(d.mainDate) },
  { id: "Next Action", en: "Next Action", width: 32, kind: "wrap", value: (d) => d.nextAction },
  { id: "Tanggal Next Action", en: "Next Action Date", width: 13, kind: "date", value: (d) => day(d.nextActionDate) },
  { id: "Blocker / Issue", en: "Blocker / Issue", width: 32, kind: "wrap", value: (d) => d.blocker },
  { id: "Catatan", en: "Notes", width: 40, kind: "wrap", value: (d) => d.notes },
  { id: "Dokumen & Link", en: "Documents & Links", width: 36, kind: "wrap", value: (d) => linksText(d) },
  { id: "Rincian Real Cost", en: "Real Cost Breakdown", width: 34, kind: "wrap", value: (d) => costLines(d.costs) },
  { id: "Terakhir Diperbarui", en: "Last Updated", width: 17, kind: "datetime", value: (d) => wib(d.updatedAt) },
  // 34 · not in the Control Tower: who last edited the deal, as the earlier NEXUS export said it.
  { id: "Diperbarui Oleh", en: "Updated By", width: 18, kind: "text", value: (d) => d.updatedBy?.name ?? "" },
]

/** The "Termin" cell of the row that carries a deal's manual payment due date (no terms). */
export const MANUAL_DUE_LABEL: Record<ExportLang, string> = {
  id: "Jatuh tempo manual (tanpa termin)",
  en: "Manual due date (no terms)",
}

const FORMAT: Partial<Record<Kind, string>> = {
  money: MONEY_FMT, moneySigned: MONEY_SIGNED_FMT, pct: PCT_FMT, pct1: PCT1_FMT, int: "0", date: DATE_FMT, datetime: DATETIME_FMT,
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } }
const BORDER: Partial<ExcelJS.Borders> = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } }

/** Empty text → an empty cell (not ""), so filters and COUNTA see nothing there. */
function cellValue(v: unknown): ExcelJS.CellValue {
  if (v === undefined || v === null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  return v as ExcelJS.CellValue
}

type SheetCol = { header: string; width: number; kind: Kind }

/** A table sheet: dark bold header, frozen header (+ `freezeCols`), autofilter, formats per column. */
function tableSheet(wb: ExcelJS.Workbook, name: string, cols: SheetCol[], rows: unknown[][], freezeCols: number) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: freezeCols, ySplit: 1, activeCell: "A2" }] })
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }))
  const head = ws.getRow(1)
  head.height = 30
  head.eachCell((cell) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = { vertical: "middle", wrapText: true }
  })
  for (const r of rows) ws.addRow(r.map(cellValue))
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    const fmt = FORMAT[c.kind]
    col.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber === 1) return
      if (fmt) cell.numFmt = fmt
      cell.alignment = { vertical: "top", wrapText: c.kind === "wrap" }
      cell.border = BORDER
    })
  })
  if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  return ws
}

export type ExportMeta = { boardName: string; exportedAt: Date; exportedBy: string | null; lang: ExportLang }

export function buildPipelineWorkbook(deals: SerializedDeal[], meta: ExportMeta): ExcelJS.Workbook {
  const en = meta.lang === "en"
  const wb = new ExcelJS.Workbook()
  wb.creator = "NEXUS"
  wb.created = meta.exportedAt
  wb.title = `${meta.boardName} — Pipeline`

  // 1 · Master Project — the GM's columns.
  tableSheet(
    wb,
    "Master Project",
    MASTER_COLUMNS.map((c) => ({ header: en ? c.en : c.id, width: c.width, kind: c.kind })),
    deals.map((d) => MASTER_COLUMNS.map((c) => c.value(d, meta.lang))),
    2,
  )

  // 2 · Payment terms — one row per term.
  const termCols: (SheetCol & { id: string })[] = [
    { id: "Project ID", header: "Project ID", width: 12, kind: "text" },
    { id: "Nama Project", header: "Project Name", width: 34, kind: "wrap" },
    { id: "Termin", header: "Term", width: 16, kind: "text" },
    { id: "Nominal", header: "Amount", width: 17, kind: "money" },
    { id: "Jatuh Tempo", header: "Due Date", width: 13, kind: "date" },
    { id: "No. Invoice", header: "Invoice No.", width: 16, kind: "text" },
    { id: "Tanggal Invoice", header: "Invoice Date", width: 13, kind: "date" },
    { id: "Dibayar", header: "Paid", width: 17, kind: "money" },
    { id: "Tanggal Bayar", header: "Paid On", width: 13, kind: "date" },
    { id: "Sisa", header: "Outstanding", width: 17, kind: "money" },
    { id: "Hari Overdue", header: "Days Overdue", width: 11, kind: "int" },
    { id: "Status", header: "Status", width: 14, kind: "text" },
    { id: "Catatan", header: "Note", width: 32, kind: "wrap" },
  ]
  // A deal without terms keeps its one manual "Jatuh Tempo Pembayaran" here, so the date is not lost from
  // the file: one row, the Termin cell saying it is that date and not a term, the rest left blank.
  const termRows = deals.flatMap((d) =>
    d.terms.length > 0
      ? d.terms.map((t) => [
          d.code, d.name, t.label, t.amount, day(t.dueDate), t.invoiceNo, day(t.invoiceDate), t.paidAmount, day(t.paidAt),
          t.outstanding, t.daysOverdue, t.status, t.note,
        ])
      : d.paymentDueDate
        ? [[d.code, d.name, MANUAL_DUE_LABEL[meta.lang], null, day(d.paymentDueDate), null, null, null, null, null, null, null, null]]
        : [],
  )
  const manualDueRows = deals.filter((d) => d.terms.length === 0 && !!d.paymentDueDate).length
  tableSheet(wb, en ? "Payment Terms" : "Termin Pembayaran", termCols.map((c) => ({ ...c, header: en ? c.header : c.id })), termRows, 2)

  // 3 · Info — what this file is.
  const info = wb.addWorksheet("Info")
  info.columns = [{ width: 24 }, { width: 70 }]
  const withCosts = deals.filter((d) => d.costs.length > 0).length
  const lines: [string, ExcelJS.CellValue, string?][] = [
    [en ? "Board" : "Board", meta.boardName],
    [en ? "Exported at (WIB)" : "Diekspor (WIB)", wib(meta.exportedAt), DATETIME_FMT],
    [en ? "Exported by" : "Diekspor oleh", meta.exportedBy ?? "—"],
    [en ? "Filter" : "Filter", en ? "None: every deal on the board (on-screen filters do not apply)" : "Tidak ada: semua deal di board (filter di layar tidak ikut)"],
    [en ? "Deals" : "Jumlah deal", deals.length],
    [en ? "Deals with real cost" : "Deal dengan real cost", withCosts],
    [en ? "Payment terms" : "Termin pembayaran", termRows.length - manualDueRows],
    [en ? "Manual due dates" : "Jatuh tempo manual", en
      ? `${manualDueRows} deal(s) without terms: their payment due date is one row on Payment Terms, marked "${MANUAL_DUE_LABEL.en}".`
      : `${manualDueRows} deal tanpa termin: jatuh tempo pembayarannya satu baris di Termin Pembayaran, bertanda "${MANUAL_DUE_LABEL.id}".`],
    [en ? "Margin" : "Margin", en
      ? "Net Project Value − Total Real Cost. Blank while the deal has no cost lines or no net value."
      : "Nilai Bersih Project − Total Real Cost. Kosong selama deal belum punya biaya atau nilai bersih belum diisi."],
    [en ? "Payment status / receivable" : "Status pembayaran / piutang", en
      ? "From the payment terms when a deal has any; otherwise the fields typed on the deal."
      : "Dari termin pembayaran bila deal punya termin; selain itu dari isian di deal."],
    [en ? "Dates" : "Tanggal", en ? "Last Updated and Exported at are WIB (UTC+7)." : "Terakhir Diperbarui dan Diekspor dalam WIB (UTC+7)."],
  ]
  const title = info.addRow([`${meta.boardName} — Pipeline`])
  title.font = { bold: true, size: 14 }
  info.addRow([])
  for (const [k, v, fmt] of lines) {
    const row = info.addRow([k, v])
    row.getCell(1).font = { bold: true }
    row.getCell(2).alignment = { wrapText: true, vertical: "top", horizontal: "left" }
    if (fmt) row.getCell(2).numFmt = fmt
  }
  return wb
}

/** "<Board> — Pipeline <YYYY-MM-DD>.xlsx", with the characters a file system refuses taken out. */
export function exportFileName(boardName: string, today: string): string {
  const board = boardName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Pipeline"
  return `${board} — Pipeline ${today}.xlsx`
}

/** Content-Disposition for that name: UTF-8 (filename*) first, then a plain-ASCII fallback. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/—/g, "-").replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}; filename="${ascii}"`
}
