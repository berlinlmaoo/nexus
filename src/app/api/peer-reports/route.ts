export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import {
  getUserOrgRole, isBodPlus, PEER_REPORT_CATEGORIES, REASON_MIN, REASON_MAX,
  REPORT_INCLUDE, serializeReport, type PeerReportCategoryKey,
} from "@/lib/peer-reports"

// GET /api/peer-reports?status=PENDING|VERIFIED|REJECTED|WITHDRAWN|ALL — BoD+ see everything.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    if (!isBodPlus(await getUserOrgRole(me))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const status = request.nextUrl.searchParams.get("status")
    const where = status && status !== "ALL" ? { status: status as never } : {}
    const reports = await prisma.peerReport.findMany({ where, include: REPORT_INCLUDE, orderBy: { createdAt: "desc" }, take: 200 })

    // Lightweight counts per status for the tab badges.
    const grouped = await prisma.peerReport.groupBy({ by: ["status"], _count: { _all: true } })
    const counts: Record<string, number> = {}
    for (const g of grouped) counts[g.status] = g._count._all

    return NextResponse.json({ reports: reports.map((r) => serializeReport(r, me)), counts })
  } catch (error) {
    console.error("Error listing peer reports:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/peer-reports — { reportedUserId, category, reason }
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    if (!isBodPlus(await getUserOrgRole(me))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const reportedUserId = String(body?.reportedUserId ?? "")
    const category = String(body?.category ?? "") as PeerReportCategoryKey
    const reason = String(body?.reason ?? "").trim()

    if (!reportedUserId) return NextResponse.json({ error: "Pilih orang yang dilaporkan." }, { status: 422 })
    if (reportedUserId === me) return NextResponse.json({ error: "Gak bisa lapor diri sendiri." }, { status: 422 })
    if (!PEER_REPORT_CATEGORIES.includes(category)) return NextResponse.json({ error: "Kategori gak valid." }, { status: 422 })
    if (reason.length < REASON_MIN) return NextResponse.json({ error: `Alasan minimal ${REASON_MIN} karakter.` }, { status: 422 })
    if (reason.length > REASON_MAX) return NextResponse.json({ error: `Alasan maksimal ${REASON_MAX} karakter.` }, { status: 422 })

    const reported = await prisma.user.findUnique({ where: { id: reportedUserId }, select: { id: true } })
    if (!reported) return NextResponse.json({ error: "User yang dilaporkan gak ketemu." }, { status: 404 })

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.peerReport.create({
        data: { reporterId: me, reportedUserId, category, reason },
        include: REPORT_INCLUDE,
      })
      await tx.peerReportEvent.create({ data: { reportId: created.id, action: "created", toStatus: "PENDING", actorId: me } })
      return created
    })

    logAudit({ action: "create", entityType: "peer_report", entityId: report.id, userId: me, request, metadata: { category, reportedUserId } })
    return NextResponse.json(serializeReport(report, me), { status: 201 })
  } catch (error) {
    console.error("Error creating peer report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
