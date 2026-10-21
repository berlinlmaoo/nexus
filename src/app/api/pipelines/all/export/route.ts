export const dynamic = "force-dynamic"

import { rememberUiLanguage } from "@/lib/notification-text"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { allPipelinesGate, loadAllPipelines, parseYearParam } from "@/lib/pipeline-all"
import { buildPipelineWorkbook, contentDisposition, exportFileName } from "@/lib/pipeline-export"

/**
 * "Download Excel" of All Pipelines (owner, 21 Oct 2026): the same workbook and columns as one board's export,
 * every board's deals in it, "Sumber / Source" = the board's name. BoD / One Above All only (403 otherwise).
 * Query: lang=id|en, source=<board id>, year=YYYY, workspaceId — as GET /api/pipelines/all.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    void rememberUiLanguage(session.user.id, request.headers, request.nextUrl)
    const sp = request.nextUrl.searchParams
    const gate = await allPipelinesGate(session.user.id, sp.get("workspaceId"))
    if (!gate.ok) return gate.response
    const year = parseYearParam(sp.get("year"))
    if (year === undefined) return NextResponse.json({ field: "year", error: "year must be YYYY.", code: "INVALID_FIELD" }, { status: 400 })
    const source = sp.get("source") || null
    if (source && !gate.boards.some((b) => b.id === source)) {
      return NextResponse.json({ field: "source", error: "Unknown pipeline board.", code: "INVALID_FIELD" }, { status: 400 })
    }
    const lang = sp.get("lang") === "en" ? "en" : "id"
    const [r, me] = await Promise.all([
      loadAllPipelines(gate, { source, year, orderByCode: true }),
      prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, email: true } }),
    ])
    const boardName = lang === "en" ? "All Pipelines" : "Semua Pipeline"
    const sourceName = source ? gate.boards.find((b) => b.id === source)?.name ?? null : null
    const wb = buildPipelineWorkbook(r.deals, {
      boardName,
      exportedAt: new Date(),
      exportedBy: me?.name || me?.email || null,
      lang,
      sourceOf: (d) => (d as { source?: { name: string } }).source?.name ?? "",
      filter: { year, source: sourceName },
    })
    logAudit({
      action: "export",
      entityType: "pipeline_deal",
      entityId: gate.workspaceId,
      entityName: boardName,
      userId: session.user.id,
      request,
      metadata: { allPipelines: true, boards: gate.boards.length, source, year, rows: r.deals.length },
    })
    const buf = await wb.xlsx.writeBuffer()
    return new NextResponse(buf as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(exportFileName(sourceName ?? boardName, r.today)),
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Error exporting all pipelines:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
