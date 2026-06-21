export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { verifyPeerReportWithXp } from "@/lib/gamification"
import {
  getUserOrgRole, isBodPlus, peerReportXpEnabled, DEFAULT_PENALTY_XP,
  REPORT_INCLUDE, serializeReport, categoryLabel,
} from "@/lib/peer-reports"

// POST /api/peer-reports/[id]/verdict — BoD only. { action: "verify" | "reject", reviewNote? }
// Verify = penalty-only XP (violator −XP, no reporter bounty) + PUBLIC announcement + Hall of Shame.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    if (!isBodPlus(await getUserOrgRole(me))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action ?? "")
    const reviewNote = body?.reviewNote ? String(body.reviewNote).trim().slice(0, 1000) : null
    if (action !== "verify" && action !== "reject") return NextResponse.json({ error: "Aksi gak valid." }, { status: 422 })

    const report = await prisma.peerReport.findUnique({ where: { id }, select: { reporterId: true, status: true } })
    if (!report) return NextResponse.json({ error: "Laporan gak ketemu." }, { status: 404 })
    if (report.status !== "PENDING") return NextResponse.json({ error: "Laporan ini udah diputus." }, { status: 409 })
    // Conflict of interest — you can't decide a report you filed.
    if (report.reporterId === me) return NextResponse.json({ error: "Gak boleh mutusin laporan yang kamu sendiri buat." }, { status: 403 })

    if (action === "reject") {
      await prisma.$transaction(async (tx) => {
        await tx.peerReport.update({ where: { id }, data: { status: "REJECTED", reviewerId: me, reviewNote, reviewedAt: new Date() } })
        await tx.peerReportEvent.create({ data: { reportId: id, action: "rejected", fromStatus: "PENDING", toStatus: "REJECTED", note: reviewNote, actorId: me } })
      })
    } else if (peerReportXpEnabled()) {
      // Penalty-only: violator −penalty, NO reporter bounty (reporting is open to all → no farming).
      const res = await verifyPeerReportWithXp({ reportId: id, reviewerId: me, reviewNote, bounty: 0, penalty: DEFAULT_PENALTY_XP })
      if (!res.ok) return NextResponse.json({ error: "Laporan ini udah diputus." }, { status: 409 })
    } else {
      // XP kill-switch (PEER_REPORT_XP_DISABLED=1) → verify = status change only, no XP.
      await prisma.$transaction(async (tx) => {
        const upd = await tx.peerReport.updateMany({ where: { id, status: "PENDING" }, data: { status: "VERIFIED", reviewerId: me, reviewNote, reviewedAt: new Date() } })
        if (upd.count === 0) throw new Error("ALREADY_DECIDED")
        await tx.peerReportEvent.create({ data: { reportId: id, action: "verified", fromStatus: "PENDING", toStatus: "VERIFIED", note: reviewNote, actorId: me } })
      })
    }

    logAudit({ action: "update", entityType: "peer_report", entityId: id, userId: me, request, metadata: { verdict: action } })
    const updated = await prisma.peerReport.findUnique({ where: { id }, include: REPORT_INCLUDE })

    // On a verified violation → company-wide POP-UP announcement (same mechanism as Control Room),
    // shown once per user. Best-effort: never fail the verdict if the announcement insert errors.
    if (action === "verify" && updated?.status === "VERIFIED") {
      try {
        await prisma.announcement.create({
          data: {
            title: "⚠️ Pelanggaran terbukti",
            body: `${updated.reportedUser.name} terbukti melanggar: ${categoryLabel(updated.category)}.`,
            tone: "warning",
            active: true,
            imageUrl: updated.evidenceUrl ?? null, // show the evidence photo in the pop-up
            createdById: me,
          },
        })
      } catch (e) {
        console.error("violation announcement failed:", e)
      }
    }

    return NextResponse.json(updated ? serializeReport(updated, me, true) : { ok: true })
  } catch (error) {
    console.error("Error deciding peer report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
