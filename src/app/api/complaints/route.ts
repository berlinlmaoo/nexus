export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { resolveMime } from "@/lib/mime"
import { isGideonTicketCategory, reviewSupportTicket } from "@/lib/gideon-ticket"
import { notifyComplaintFiled } from "@/lib/notification-service"
import {
  getUserOrgRole, isBodPlus, COMPLAINT_CATEGORIES, SUBJECT_MIN, SUBJECT_MAX, BODY_MIN, BODY_MAX,
  COMPLAINT_LIST_INCLUDE, COMPLAINT_INBOX_STATUSES, COMPLAINT_STATUSES, serializeComplaint,
  complaintCategoryLabel, type ComplaintCategoryKey, type ComplaintStatusKey,
} from "@/lib/complaints"

const EVIDENCE_MAX = 8 * 1024 * 1024 // 8MB per photo
const EVIDENCE_MAX_COUNT = 5   // per ticket — generous for screenshots, bounded against disk abuse

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

    // ?status= takes one status, a comma-separated set, or ALL/absent for everything.
    //
    // A bare "OPEN" widens to the whole inbox set (OPEN + AWAITING_DECISION), and that is the point
    // rather than a shortcut. "OPEN" has always meant "nobody has taken this on", and GIDEON
    // answering a ticket does not change that — it annotates the ticket, it does not claim it. Every
    // client that already exists, the iOS build in somebody's pocket included, asks for OPEN and
    // would otherwise watch its inbox drain the day this status starts being written. Anyone who
    // wants only the answered ones asks for AWAITING_DECISION by name.
    const statusParam = request.nextUrl.searchParams.get("status")
    const requested = (statusParam ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    const filtering = requested.length > 0 && !requested.includes("ALL")
    const wanted = requested
      .flatMap((s) => (s === "OPEN" ? [...COMPLAINT_INBOX_STATUSES] : [s]))
      .filter((s, i, a) => COMPLAINT_STATUSES.includes(s as ComplaintStatusKey) && a.indexOf(s) === i)

    // Workspace-scoped (defense in depth). BoD see all; others only their own.
    const scope: Record<string, unknown> = { workspaceId: membership.workspaceId, ...(viewerIsBod ? {} : { reporterId: me }) }
    const where: Record<string, unknown> = { ...scope }
    // `in: []` when a caller asks for a status that does not exist: zero tickets are in it, which is
    // a truer answer than the whole list, and better than the 500 an unknown enum value used to give.
    if (filtering) where.status = { in: wanted }

    const [complaints, grouped] = await Promise.all([
      prisma.complaint.findMany({ where, include: COMPLAINT_LIST_INCLUDE, orderBy: { lastMessageAt: "desc" }, take: 200 }),
      prisma.complaint.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    ])
    const counts: Record<string, number> = {}
    for (const g of grouped) counts[g.status] = g._count._all
    // counts[k] means "how many rows ?status=k returns", not "how many rows literally hold k". The
    // two differ only for OPEN, which the inbox filter widens above — and a tab badge that disagreed
    // with the list under it is a worse bug than a documented count. The literal number for the
    // widened half is still here under its own key, so a client can show both.
    const inbox = COMPLAINT_INBOX_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0)
    if (inbox > 0) counts.OPEN = inbox

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

    // Multipart: text fields + a REQUIRED evidence photo.
    const form = await request.formData()
    const category = String(form.get("category") ?? "") as ComplaintCategoryKey
    const subject = String(form.get("subject") ?? "").trim()
    const message = String(form.get("body") ?? "").trim()
    // Several photos allowed — one screenshot rarely tells the whole story. Older clients that send
    // a single "evidence" part still work, because getAll() returns that as a one-item list.
    const evidenceFiles = form.getAll("evidence").filter((f): f is File => f instanceof File && f.size > 0)

    if (!COMPLAINT_CATEGORIES.includes(category)) return NextResponse.json({ error: "Kategori gak valid." }, { status: 422 })
    if (subject.length < SUBJECT_MIN) return NextResponse.json({ error: `Judul minimal ${SUBJECT_MIN} karakter.` }, { status: 422 })
    if (subject.length > SUBJECT_MAX) return NextResponse.json({ error: `Judul maksimal ${SUBJECT_MAX} karakter.` }, { status: 422 })
    if (message.length < BODY_MIN) return NextResponse.json({ error: `Isi keluhan minimal ${BODY_MIN} karakter.` }, { status: 422 })
    if (message.length > BODY_MAX) return NextResponse.json({ error: `Isi keluhan maksimal ${BODY_MAX} karakter.` }, { status: 422 })
    // At least one photo is still required; the cap keeps a single ticket from filling the disk.
    if (evidenceFiles.length === 0) return NextResponse.json({ error: "Foto bukti wajib dilampirin." }, { status: 422 })
    if (evidenceFiles.length > EVIDENCE_MAX_COUNT) return NextResponse.json({ error: `Maksimal ${EVIDENCE_MAX_COUNT} foto.` }, { status: 422 })
    // Validate EVERY file before writing any of them — a half-written set would leave orphan files
    // on disk for a request that then fails.
    const validated = evidenceFiles.map((f) => ({ file: f, mimeType: resolveMime(f.type, f.name) }))
    for (const { file, mimeType } of validated) {
      if (file.size > EVIDENCE_MAX) return NextResponse.json({ error: "Foto bukti terlalu besar (maks 8MB per foto)." }, { status: 422 })
      if (!mimeType.startsWith("image/")) return NextResponse.json({ error: "Bukti harus berupa foto." }, { status: 422 })
    }

    // Store the evidence photos (gated /api/files/complaints/).
    const uploadDir = path.join(process.cwd(), "public", "uploads", "complaints")
    await mkdir(uploadDir, { recursive: true })
    const stored: { url: string; mimeType: string; size: number; position: number }[] = []
    for (const [i, { file, mimeType }] of validated.entries()) {
      const ext = path.extname(file.name) || ".jpg"
      const safeName = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
      await writeFile(path.join(uploadDir, safeName), Buffer.from(await file.arrayBuffer()))
      stored.push({ url: `/api/files/complaints/${safeName}`, mimeType, size: file.size, position: i })
    }
    // Legacy single columns keep the FIRST photo so old readers (and the 4 pre-existing tickets)
    // stay valid while reads move to the attachments table.
    const evidenceUrl = stored[0].url
    const evidenceMimeType = stored[0].mimeType

    const created = await prisma.$transaction(async (tx) => {
      const complaint = await tx.complaint.create({
        data: {
          workspaceId: membership.workspaceId,
          reporterId: me,
          category,
          subject: subject.slice(0, SUBJECT_MAX),
          evidenceUrl,
          evidenceMimeType,
          evidenceSize: stored[0].size,
          attachments: { create: stored },
          status: "OPEN",
          messages: { create: { authorId: me, fromReviewer: false, body: message.slice(0, BODY_MAX) } },
        },
        include: COMPLAINT_LIST_INCLUDE,
      })
      await tx.complaintEvent.create({ data: { complaintId: complaint.id, action: "filed", toStatus: "OPEN", actorId: me } })
      return complaint
    })

    logAudit({ action: "create", entityType: "complaint", entityId: created.id, userId: me, request, metadata: { category } })
    void notifyComplaintFiled({ workspaceId: membership.workspaceId, complaintId: created.id, categoryLabel: complaintCategoryLabel(category) }).catch(() => {})

    // ATTENDANCE, EXP and DAY_OFF tickets get a first pass from GIDEON: it reads the photo, checks the
    // day against the record, and either proposes a correction or says why it cannot. Fire-and-forget
    // on purpose — filing the ticket already succeeded, and it must not wait on, or fail because of,
    // an assistant taking half a minute to look at a picture. What it may DO differs by category and
    // is decided inside reviewSupportTicket; DAY_OFF is answer-only.
    if (isGideonTicketCategory(category)) {
      void reviewSupportTicket(created.id).catch(() => {})
    }

    return NextResponse.json(serializeComplaint(created, me, isBodPlus(membership.role)), { status: 201 })
  } catch (error) {
    console.error("Error creating complaint:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
