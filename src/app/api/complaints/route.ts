export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { notifyComplaintFiled } from "@/lib/notification-service"
import {
  getUserOrgRole, isBodPlus, COMPLAINT_CATEGORIES, SUBJECT_MIN, SUBJECT_MAX, BODY_MIN, BODY_MAX,
  COMPLAINT_LIST_INCLUDE, serializeComplaint, complaintCategoryLabel, type ComplaintCategoryKey,
} from "@/lib/complaints"

// GET /api/complaints?status=… — BoD see every complaint in the workspace; everyone else sees only
// the ones they filed. Reporter identity is anonymized in the serializer for anonymous complaints.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: me }, select: { workspaceId: true, role: true } })
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const viewerIsBod = isBodPlus(membership.role)

    const status = request.nextUrl.searchParams.get("status")
    // Workspace-scoped (defense in depth). BoD see all; others only their own.
    const scope: Record<string, unknown> = { workspaceId: membership.workspaceId, ...(viewerIsBod ? {} : { reporterId: me }) }
    const where: Record<string, unknown> = { ...scope }
    if (status && status !== "ALL") where.status = status

    const [complaints, grouped] = await Promise.all([
      prisma.complaint.findMany({ where, include: COMPLAINT_LIST_INCLUDE, orderBy: { lastMessageAt: "desc" }, take: 200 }),
      prisma.complaint.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    ])
    const counts: Record<string, number> = {}
    for (const g of grouped) counts[g.status] = g._count._all

    return NextResponse.json({ complaints: complaints.map((c) => serializeComplaint(c, me, viewerIsBod)), counts, viewerIsBod })
  } catch (error) {
    console.error("Error listing complaints:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/complaints — JSON: { category, subject, body, anonymous?, confidential? }.
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: me }, select: { workspaceId: true, role: true } })
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const category = String(body.category ?? "") as ComplaintCategoryKey
    const subject = String(body.subject ?? "").trim()
    const message = String(body.body ?? "").trim()
    const anonymous = body.anonymous === true
    const confidential = body.confidential === true

    if (!COMPLAINT_CATEGORIES.includes(category)) return NextResponse.json({ error: "Kategori gak valid." }, { status: 422 })
    if (subject.length < SUBJECT_MIN) return NextResponse.json({ error: `Judul minimal ${SUBJECT_MIN} karakter.` }, { status: 422 })
    if (subject.length > SUBJECT_MAX) return NextResponse.json({ error: `Judul maksimal ${SUBJECT_MAX} karakter.` }, { status: 422 })
    if (message.length < BODY_MIN) return NextResponse.json({ error: `Isi keluhan minimal ${BODY_MIN} karakter.` }, { status: 422 })
    if (message.length > BODY_MAX) return NextResponse.json({ error: `Isi keluhan maksimal ${BODY_MAX} karakter.` }, { status: 422 })

    const created = await prisma.$transaction(async (tx) => {
      const complaint = await tx.complaint.create({
        data: {
          workspaceId: membership.workspaceId,
          reporterId: me,
          category,
          subject: subject.slice(0, SUBJECT_MAX),
          anonymous,
          confidential,
          status: "OPEN",
          messages: { create: { authorId: me, fromReviewer: false, body: message.slice(0, BODY_MAX) } },
        },
        include: COMPLAINT_LIST_INCLUDE,
      })
      await tx.complaintEvent.create({ data: { complaintId: complaint.id, action: "filed", toStatus: "OPEN", actorId: me } })
      return complaint
    })

    // PRIVACY: the audit log is BoD/Manager-readable (incl. the actor's name) — writing an actor-tagged
    // entry for an ANONYMOUS complaint would deanonymize the reporter. So only audit non-anonymous ones.
    // (The server-internal ComplaintEvent still records actorId for abuse investigation; it's never exposed.)
    if (!anonymous) {
      logAudit({ action: "create", entityType: "complaint", entityId: created.id, userId: me, request, metadata: { category, confidential } })
    }
    void notifyComplaintFiled({ workspaceId: membership.workspaceId, complaintId: created.id, categoryLabel: complaintCategoryLabel(category), anonymous }).catch(() => {})

    return NextResponse.json(serializeComplaint(created, me, isBodPlus(membership.role)), { status: 201 })
  } catch (error) {
    console.error("Error creating complaint:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
