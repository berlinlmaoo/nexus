export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { notifyComplaintReply } from "@/lib/notification-service"
import {
  isBodPlus, BODY_MIN, BODY_MAX, COMPLAINT_DETAIL_INCLUDE, serializeComplaintDetail,
} from "@/lib/complaints"

// POST /api/complaints/[id]/messages — { body }. The reporter or any BoD may reply (unless CLOSED).
// A BoD reply on an OPEN complaint moves it to IN_REVIEW.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: me }, select: { workspaceId: true, role: true } })
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const viewerIsBod = isBodPlus(membership.role)
    const { id } = await params

    const payload = await request.json().catch(() => ({}))
    const text = String(payload?.body ?? "").trim()
    if (text.length < BODY_MIN) return NextResponse.json({ error: `Balasan minimal ${BODY_MIN} karakter.` }, { status: 422 })

    const complaint = await prisma.complaint.findUnique({ where: { id }, select: { id: true, workspaceId: true, status: true, reporterId: true } })
    if (!complaint || complaint.workspaceId !== membership.workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!viewerIsBod && complaint.reporterId !== me) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (complaint.status === "CLOSED") return NextResponse.json({ error: "Keluhan ini sudah ditutup." }, { status: 409 })

    // A BoD picking up an OPEN complaint flips it to IN_REVIEW; otherwise status is untouched.
    const bumpToReview = viewerIsBod && complaint.status === "OPEN"
    await prisma.$transaction(async (tx) => {
      await tx.complaintMessage.create({ data: { complaintId: id, authorId: me, fromReviewer: viewerIsBod, body: text.slice(0, BODY_MAX) } })
      await tx.complaint.update({ where: { id }, data: { lastMessageAt: new Date(), ...(bumpToReview ? { status: "IN_REVIEW" } : {}) } })
      if (bumpToReview) await tx.complaintEvent.create({ data: { complaintId: id, action: "status", fromStatus: "OPEN", toStatus: "IN_REVIEW", actorId: me } })
    })

    // Notify the other side: a BoD reply pings the reporter; a reporter reply pings the BoD.
    void notifyComplaintReply({ complaintId: id, workspaceId: membership.workspaceId, reporterId: complaint.reporterId, fromReviewer: viewerIsBod, replierId: me }).catch(() => {})

    const fresh = await prisma.complaint.findUnique({ where: { id }, include: COMPLAINT_DETAIL_INCLUDE })
    return NextResponse.json(serializeComplaintDetail(fresh!, me, viewerIsBod))
  } catch (error) {
    console.error("Error posting complaint message:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
