export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getUserOrgRole, isBodPlus, REPORT_INCLUDE, serializeReport } from "@/lib/peer-reports"

// POST /api/peer-reports/[id]/withdraw — the reporter pulls their own still-pending report.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const role = await getUserOrgRole(me)
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 }) // members only
    const { id } = await params

    const report = await prisma.peerReport.findUnique({ where: { id }, select: { reporterId: true, status: true } })
    if (!report) return NextResponse.json({ error: "Laporan gak ketemu." }, { status: 404 })
    if (report.reporterId !== me) return NextResponse.json({ error: "Cuma pelapor yang bisa narik laporannya." }, { status: 403 })
    if (report.status !== "PENDING") return NextResponse.json({ error: "Laporan ini udah diputus." }, { status: 409 })

    await prisma.$transaction(async (tx) => {
      await tx.peerReport.update({ where: { id }, data: { status: "WITHDRAWN" } })
      await tx.peerReportEvent.create({ data: { reportId: id, action: "withdrawn", fromStatus: "PENDING", toStatus: "WITHDRAWN", actorId: me } })
    })

    logAudit({ action: "update", entityType: "peer_report", entityId: id, userId: me, request, metadata: { withdrawn: true } })
    const updated = await prisma.peerReport.findUnique({ where: { id }, include: REPORT_INCLUDE })
    return NextResponse.json(updated ? serializeReport(updated, me, isBodPlus(role)) : { ok: true })
  } catch (error) {
    console.error("Error withdrawing peer report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
