export const dynamic = "force-dynamic"

import { rememberUiLanguage } from "@/lib/notification-text"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { filterByYear, parseYearParam, pipelineToday } from "@/lib/pipeline"
import { dealInclude, pipelineGate, serializeDeal } from "@/lib/pipeline-server"
import { buildPipelineWorkbook, contentDisposition, exportFileName, parseColumnsParam } from "@/lib/pipeline-export"

/**
 * "Download Excel" of a Pipeline board (owner, 9 Oct 2026; tidied 14 Oct 2026 to the GM's export): the
 * workbook is lib/pipeline-export.ts. Same access as the board: anyone who may read it (Full / Can edit /
 * Can comment / Can view) gets every column, the real cost ones included; anyone else 403. Headers follow
 * ?lang=id|en (the screen's language).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    // Released iOS/Android send their in-app language here (?lang=): the one request that reveals it.
    void rememberUiLanguage(session.user.id, request.headers, request.nextUrl)
    const gate = await pipelineGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const lang = request.nextUrl.searchParams.get("lang") === "en" ? "en" : "id"
    // ?year=YYYY (Control Tower v8): only the deals whose event date falls in that year, as the board's year filter.
    const year = parseYearParam(request.nextUrl.searchParams.get("year"))
    if (year === undefined) return NextResponse.json({ field: "year", error: "year must be YYYY.", code: "INVALID_FIELD" }, { status: 400 })

    const [rows, me] = await Promise.all([
      prisma.pipelineDeal.findMany({ where: { projectId }, include: dealInclude, orderBy: { code: "asc" } }),
      prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, email: true } }),
    ])
    const today = pipelineToday()
    const deals = filterByYear(rows.map((row) => serializeDeal(row, today)), year)
    const wb = buildPipelineWorkbook(deals, {
      boardName: gate.project.name,
      exportedAt: new Date(),
      exportedBy: me?.name || me?.email || null,
      lang,
      filter: { year },
      // ?columns=legacy: the pre-v8 columns (the web while flags.web017Launch is off); apps get every column.
      columns: parseColumnsParam(request.nextUrl.searchParams.get("columns")),
    })

    logAudit({
      action: "export",
      entityType: "pipeline_deal",
      entityId: projectId,
      entityName: gate.project.name,
      userId: session.user.id,
      request,
      metadata: { projectId, rows: deals.length, ...(year ? { year } : {}) },
    })

    const buf = await wb.xlsx.writeBuffer()
    return new NextResponse(buf as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(exportFileName(gate.project.name, today)),
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Error exporting pipeline:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
