export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { pipelineToday, type HealthKey } from "@/lib/pipeline"
import { dealInclude, pipelineGate, serializeDeal } from "@/lib/pipeline-server"

/**
 * "Unduh Excel" of the GM's board (owner, 9 Oct 2026): one "Master Project" sheet, his columns in his
 * order, plus BD/PM as names, days overdue and health. Headers follow ?lang=id|en (the screen's
 * language); stored values (stages, statuses) stay the keys everyone already uses in the sheet.
 */

const HEALTH: Record<HealthKey, [string, string]> = {
  CRITICAL: ["Kritis", "Critical"],
  ATTENTION: ["Perhatian", "Attention"],
  HEALTHY: ["Sehat", "Healthy"],
  NOT_STARTED: ["Belum Mulai", "Not Started"],
  NONE: ["—", "—"],
}

type Col = { id: string; en: string; key: string; width: number; money?: boolean; pct?: boolean }

const COLUMNS: Col[] = [
  { id: "Project ID", en: "Project ID", key: "code", width: 12 },
  { id: "Nama Project", en: "Project Name", key: "name", width: 36 },
  { id: "Brand/Client", en: "Brand/Client", key: "brand", width: 18 },
  { id: "Service", en: "Service", key: "service", width: 16 },
  { id: "BD", en: "BD", key: "bdLabel", width: 18 },
  { id: "PM", en: "PM", key: "pmLabel", width: 18 },
  { id: "Fase Pipeline", en: "Pipeline Phase", key: "stage", width: 22 },
  { id: "Probabilitas", en: "Probability", key: "probability", width: 12, pct: true },
  { id: "Nilai Kontrak", en: "Contract Value", key: "contractValue", width: 16, money: true },
  { id: "Nilai Bersih Project", en: "Net Project Value", key: "netValue", width: 18, money: true },
  { id: "Nilai Invoice", en: "Invoice Value", key: "invoiceValue", width: 16, money: true },
  { id: "Status Kontrak", en: "Contract Status", key: "contractStatus", width: 18 },
  { id: "Status Vendor Registration", en: "Vendor Registration Status", key: "vregStatus", width: 22 },
  { id: "Execution Readiness", en: "Execution Readiness", key: "readiness", width: 14 },
  { id: "Status Deliverable", en: "Deliverable Status", key: "deliverableStatus", width: 18 },
  { id: "Risiko Deliverable", en: "Deliverable Risk", key: "deliverableRisk", width: 14 },
  { id: "Status Pembayaran", en: "Payment Status", key: "paymentStatus", width: 14 },
  { id: "Piutang Outstanding", en: "Outstanding Receivable", key: "outstandingReceivable", width: 18, money: true },
  { id: "Jatuh Tempo Pembayaran", en: "Payment Due Date", key: "paymentDueDate", width: 14 },
  { id: "Hari Overdue", en: "Days Overdue", key: "daysOverdue", width: 10 },
  { id: "Posisi Kas Bersih", en: "Net Cash Position", key: "netCash", width: 18, money: true },
  { id: "Status Closing", en: "Closing Status", key: "closingStatus", width: 22 },
  { id: "Project Health", en: "Project Health", key: "healthLabel", width: 12 },
  { id: "Tanggal Event", en: "Event Date", key: "mainDate", width: 13 },
  { id: "Next Action", en: "Next Action", key: "nextAction", width: 30 },
  { id: "Tanggal Next Action", en: "Next Action Date", key: "nextActionDate", width: 13 },
  { id: "Blocker / Issue", en: "Blocker / Issue", key: "blocker", width: 30 },
  { id: "Catatan", en: "Notes", key: "notes", width: 40 },
  { id: "Dokumen & Link", en: "Documents & Links", key: "linksText", width: 40 },
  { id: "Terakhir Diperbarui", en: "Last Updated", key: "updatedLabel", width: 24 },
]

/** A text cell that starts like a formula is written as text, so a deal name cannot run in Excel. */
function safe(v: unknown): unknown {
  return typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const gate = await pipelineGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const en = request.nextUrl.searchParams.get("lang") === "en"

    const rows = await prisma.pipelineDeal.findMany({ where: { projectId }, include: dealInclude, orderBy: { code: "asc" } })
    const today = pipelineToday()

    const wb = new ExcelJS.Workbook()
    wb.creator = "NEXUS"
    const ws = wb.addWorksheet("Master Project", { views: [{ state: "frozen", ySplit: 1 }] })
    ws.columns = COLUMNS.map((c) => ({ header: en ? c.en : c.id, key: c.key, width: c.width }))
    ws.getRow(1).font = { bold: true }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }

    for (const row of rows) {
      const d = serializeDeal(row, today)
      const values: Record<string, unknown> = {
        ...d,
        bdLabel: d.bd?.name ?? d.bdName ?? "",
        pmLabel: d.pm?.name ?? d.pmName ?? "",
        healthLabel: HEALTH[d.health.key][en ? 1 : 0],
        linksText: d.links.map((l) => `${l.type}: ${l.url}`).join(" | "),
        updatedLabel: `${d.updatedAt.slice(0, 16).replace("T", " ")} UTC${d.updatedBy?.name ? ` · ${d.updatedBy.name}` : ""}`,
      }
      const out: Record<string, unknown> = {}
      for (const c of COLUMNS) out[c.key] = safe(values[c.key] ?? "")
      ws.addRow(out)
    }
    for (const c of COLUMNS) {
      if (c.money) ws.getColumn(c.key).numFmt = '"Rp"#,##0;-"Rp"#,##0'
      if (c.pct) ws.getColumn(c.key).numFmt = "0%"
    }

    logAudit({
      action: "export",
      entityType: "pipeline_deal",
      entityId: projectId,
      entityName: gate.project.name,
      userId: session.user.id,
      request,
      metadata: { projectId, rows: rows.length },
    })

    const buf = await wb.xlsx.writeBuffer()
    const base = `Pipeline_${gate.project.name.replace(/[^\w.-]+/g, "_").slice(0, 60)}_${today}`
    return new NextResponse(buf as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Error exporting pipeline:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
