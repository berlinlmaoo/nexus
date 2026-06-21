export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getUserOrgRole, isBodPlus, REBUTTAL_MAX, REPORT_INCLUDE, serializeReport } from "@/lib/peer-reports"

// POST /api/peer-reports/[id]/rebuttal — the REPORTED person responds, while still PENDING. { rebuttal }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const role = await getUserOrgRole(me)
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params

    const body = await request.json().catch(() => ({}))
    const rebuttal = String(body?.rebuttal ?? "").trim()
    if (!rebuttal) return NextResponse.json({ error: "Bantahan gak boleh kosong." }, { status: 422 })
    if (rebuttal.length > REBUTTAL_MAX) return NextResponse.json({ error: `Bantahan maksimal ${REBUTTAL_MAX} karakter.` }, { status: 422 })

    const report = await prisma.peerReport.findUnique({ where: { id }, select: { reportedUserId: true, status: true } })
    if (!report) return NextResponse.json({ error: "Laporan gak ketemu." }, { status: 404 })
    if (report.reportedUserId !== me) return NextResponse.json({ error: "Cuma orang yang dilaporkan yang bisa kasih bantahan." }, { status: 403 })
    if (report.status !== "PENDING") return NextResponse.json({ error: "Laporan ini udah diputus." }, { status: 409 })

    await prisma.$transaction(async (tx) => {
      await tx.peerReport.update({ where: { id }, data: { rebuttal, rebuttalAt: new Date() } })
      await tx.peerReportEvent.create({ data: { reportId: id, action: "rebuttal", note: rebuttal.slice(0, 200), actorId: me } })
    })

    logAudit({ action: "update", entityType: "peer_report", entityId: id, userId: me, request, metadata: { rebuttal: true } })
    const updated = await prisma.peerReport.findUnique({ where: { id }, include: REPORT_INCLUDE })
    return NextResponse.json(updated ? serializeReport(updated, me, isBodPlus(role)) : { ok: true })
  } catch (error) {
    console.error("Error submitting rebuttal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
