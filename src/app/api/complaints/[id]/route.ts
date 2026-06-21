export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { notifyComplaintStatus } from "@/lib/notification-service"
import {
  isBodPlus, COMPLAINT_STATUSES, COMPLAINT_DETAIL_INCLUDE, serializeComplaintDetail, type ComplaintStatusKey,
} from "@/lib/complaints"

async function load(id: string) {
  return prisma.complaint.findUnique({ where: { id }, include: COMPLAINT_DETAIL_INCLUDE })
}

// GET /api/complaints/[id] — full thread. Visible to the reporter or any BoD (workspace-scoped).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: me }, select: { workspaceId: true, role: true } })
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const viewerIsBod = isBodPlus(membership.role)
    const { id } = await params

    const complaint = await load(id)
    if (!complaint || complaint.workspaceId !== membership.workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!viewerIsBod && complaint.reporterId !== me) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    return NextResponse.json(serializeComplaintDetail(complaint, me, viewerIsBod))
  } catch (error) {
    console.error("Error loading complaint:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/complaints/[id] — BoD only. { status }. RESOLVED/CLOSED stamps resolvedAt + resolvedById.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: me }, select: { workspaceId: true, role: true } })
    if (!membership || !isBodPlus(membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params

    const body = await request.json().catch(() => ({}))
    const status = String(body?.status ?? "") as ComplaintStatusKey
    if (!COMPLAINT_STATUSES.includes(status)) return NextResponse.json({ error: "Status gak valid." }, { status: 422 })

    const existing = await prisma.complaint.findUnique({ where: { id }, select: { id: true, workspaceId: true, status: true, reporterId: true } })
    if (!existing || existing.workspaceId !== membership.workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (existing.status === status) {
      const fresh = await load(id)
      return NextResponse.json(serializeComplaintDetail(fresh!, me, true))
    }

    const closing = status === "RESOLVED" || status === "CLOSED"
    await prisma.$transaction(async (tx) => {
      await tx.complaint.update({
        where: { id },
        data: {
          status,
          resolvedAt: closing ? new Date() : null,
          resolvedById: closing ? me : null,
        },
      })
      await tx.complaintEvent.create({ data: { complaintId: id, action: "status", fromStatus: existing.status, toStatus: status, actorId: me } })
    })

    logAudit({ action: "update", entityType: "complaint", entityId: id, userId: me, request, metadata: { status } })
    void notifyComplaintStatus({ reporterId: existing.reporterId, complaintId: id, status }).catch(() => {})

    const fresh = await load(id)
    return NextResponse.json(serializeComplaintDetail(fresh!, me, true))
  } catch (error) {
    console.error("Error updating complaint:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
