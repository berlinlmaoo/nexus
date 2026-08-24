export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess } from "@/lib/pnl"
// Shared with the spreadsheet export — one copy of the formula-injection guard, not two.
import { csvCell } from "@/lib/csv"

/** Year-scoped CSV of every transaction (expenses + income payments), Excel/Sheets-friendly. */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const projectId = request.nextUrl.searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const gate = await checkPnlAccess(session.user.id, projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const nowYear = new Date().getUTCFullYear()
    const yearRaw = Number(request.nextUrl.searchParams.get("year"))
    const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : nowYear
    const yearStart = new Date(Date.UTC(year, 0, 1))
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1))

    const [expenses, payments] = await Promise.all([
      prisma.pnlExpense.findMany({
        where: { projectId, date: { gte: yearStart, lt: yearEnd } },
        include: { category: { select: { name: true } } },
        orderBy: { date: "asc" },
      }),
      prisma.pnlIncomePayment.findMany({
        where: { income: { projectId }, date: { gte: yearStart, lt: yearEnd } },
        include: { income: { select: { title: true } } },
        orderBy: { date: "asc" },
      }),
    ])

    const rows: string[] = ["Tanggal,Tipe,Jumlah,Kategori/Deal,Keterangan"]
    type Row = { date: Date; line: string }
    const all: Row[] = []
    for (const e of expenses) {
      all.push({
        date: e.date,
        line: [
          e.date.toISOString().slice(0, 10),
          "Pengeluaran",
          -e.amount,
          csvCell(e.category?.name ?? "Tanpa kategori"),
          csvCell(e.description),
        ].join(","),
      })
    }
    for (const p of payments) {
      all.push({
        date: p.date,
        line: [
          p.date.toISOString().slice(0, 10),
          "Uang masuk",
          p.amount,
          csvCell(p.income.title),
          csvCell(p.note),
        ].join(","),
      })
    }
    all.sort((a, b) => a.date.getTime() - b.date.getTime())
    rows.push(...all.map((r) => r.line))

    logAudit({ action: "export", entityType: "pnl_dashboard", entityId: projectId, entityName: gate.project.name, userId: session.user.id, request, metadata: { year, rows: all.length } })

    // BOM so Excel opens it as UTF-8 directly.
    const csv = "﻿" + rows.join("\n")
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pnl-${year}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Error exporting P&L CSV:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
