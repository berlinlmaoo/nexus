export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { resolveMime } from "@/lib/mime"
import { notifyPeerReportFiled } from "@/lib/notification-service"
import {
  getUserOrgRole, isBodPlus, PEER_REPORT_CATEGORIES, REASON_MIN, REASON_MAX,
  REPORT_INCLUDE, serializeReport, categoryLabel, type PeerReportCategoryKey,
} from "@/lib/peer-reports"

const EVIDENCE_MAX = 8 * 1024 * 1024 // 8MB

// GET /api/peer-reports?status=… — BoD see every report; everyone else sees only ones they filed
// or that are against them. Reporter identity is anonymized in the serializer for non-BoD viewers.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const role = await getUserOrgRole(me)
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 }) // must be a workspace member
    const viewerIsBod = isBodPlus(role)

    const status = request.nextUrl.searchParams.get("status")
    const scope = viewerIsBod ? {} : { OR: [{ reporterId: me }, { reportedUserId: me }] }
    const where: Record<string, unknown> = { ...scope }
    if (status && status !== "ALL") where.status = status

    const [reports, grouped] = await Promise.all([
      prisma.peerReport.findMany({ where, include: REPORT_INCLUDE, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.peerReport.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    ])
    const counts: Record<string, number> = {}
    for (const g of grouped) counts[g.status] = g._count._all

    return NextResponse.json({ reports: reports.map((r) => serializeReport(r, me, viewerIsBod)), counts, viewerIsBod })
  } catch (error) {
    console.error("Error listing peer reports:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/peer-reports — multipart: reportedUserId, category, reason, evidence (photo, REQUIRED).
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const role = await getUserOrgRole(me)
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 }) // members only

    const form = await request.formData()
    const reportedUserId = String(form.get("reportedUserId") ?? "")
    const category = String(form.get("category") ?? "") as PeerReportCategoryKey
    const reason = String(form.get("reason") ?? "").trim()
    const evidence = form.get("evidence")

    if (!reportedUserId) return NextResponse.json({ error: "Pilih orang yang dilaporkan." }, { status: 422 })
    if (reportedUserId === me) return NextResponse.json({ error: "Gak bisa lapor diri sendiri." }, { status: 422 })
    if (!PEER_REPORT_CATEGORIES.includes(category)) return NextResponse.json({ error: "Kategori gak valid." }, { status: 422 })
    if (reason.length < REASON_MIN) return NextResponse.json({ error: `Alasan minimal ${REASON_MIN} karakter.` }, { status: 422 })
    if (reason.length > REASON_MAX) return NextResponse.json({ error: `Alasan maksimal ${REASON_MAX} karakter.` }, { status: 422 })
    // Evidence photo is required.
    if (!(evidence instanceof File) || evidence.size <= 0) return NextResponse.json({ error: "Foto bukti wajib dilampirin." }, { status: 422 })
    if (evidence.size > EVIDENCE_MAX) return NextResponse.json({ error: "Foto bukti terlalu besar (maks 8MB)." }, { status: 422 })
    const evidenceMimeType = resolveMime(evidence.type, evidence.name)
    if (!evidenceMimeType.startsWith("image/")) return NextResponse.json({ error: "Bukti harus berupa foto." }, { status: 422 })

    const reported = await prisma.user.findUnique({ where: { id: reportedUserId }, select: { id: true } })
    if (!reported) return NextResponse.json({ error: "User yang dilaporkan gak ketemu." }, { status: 404 })
    // BoD-and-above can't be reported.
    if (isBodPlus(await getUserOrgRole(reportedUserId))) return NextResponse.json({ error: "BoD ke atas gak bisa dilaporkan." }, { status: 422 })

    // Store the evidence photo (gated /api/files/peer-reports/).
    const uploadDir = path.join(process.cwd(), "public", "uploads", "peer-reports")
    await mkdir(uploadDir, { recursive: true })
    const ext = path.extname(evidence.name) || ".jpg"
    const safeName = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    await writeFile(path.join(uploadDir, safeName), Buffer.from(await evidence.arrayBuffer()))
    const evidenceUrl = `/api/files/peer-reports/${safeName}`

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.peerReport.create({
        data: { reporterId: me, reportedUserId, category, reason, evidenceUrl, evidenceMimeType, evidenceSize: evidence.size },
        include: REPORT_INCLUDE,
      })
      await tx.peerReportEvent.create({ data: { reportId: created.id, action: "created", toStatus: "PENDING", actorId: me } })
      return created
    })

    logAudit({ action: "create", entityType: "peer_report", entityId: report.id, userId: me, request, metadata: { category, reportedUserId } })
    // Due process — tell the reported person (reporter stays anonymous) so they can rebut.
    void notifyPeerReportFiled({ reportedUserId, categoryLabel: categoryLabel(category) }).catch(() => {})

    return NextResponse.json(serializeReport(report, me, isBodPlus(role)), { status: 201 })
  } catch (error) {
    console.error("Error creating peer report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
