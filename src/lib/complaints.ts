// Complaint & Escalation channel — shared constants + serializers.
// Private, categorized chat between a staff member and the BoD. Confidential (BoD-only review) with an
// optional ANONYMOUS mode (reporter hidden even from BoD). Distinct from PeerReport (public + punitive).
export { getUserOrgRole, isBodPlus } from "@/lib/feed" // reuse the org-role gate helpers
import { GIDEON_EMAIL } from "@/lib/gideon-identity"
import {
  ATTENDANCE_CORRECTION_INCLUDE, serializeAttendanceCorrection, type AttendanceCorrectionRow,
} from "@/lib/attendance-correction"

// Active categories users can file under. (PAYROLL/OPERATIONAL/HR/LEADERSHIP retired 2026-06-22 — kept in
// the Prisma enum + label map below so any legacy record still renders, just no longer selectable/acceptable.)
export const COMPLAINT_CATEGORIES = [
  "ATTENDANCE", "EXP", "DAY_OFF", "OTHER",
] as const
export type ComplaintCategoryKey = (typeof COMPLAINT_CATEGORIES)[number]

export const COMPLAINT_CATEGORY_LABEL: Record<string, string> = {
  ATTENDANCE: "Absensi",
  EXP: "EXP / Gamifikasi",
  PAYROLL: "Payroll / Gaji",
  DAY_OFF: "Cuti / Day-Off",
  OPERATIONAL: "Operasional",
  HR: "HR",
  LEADERSHIP: "Kepemimpinan",
  OTHER: "Lainnya",
}
export const complaintCategoryLabel = (k: string) => COMPLAINT_CATEGORY_LABEL[k] ?? k

// AWAITING_DECISION ("Menunggu keputusan") sits between OPEN and IN_REVIEW: GIDEON has answered,
// and/or a correction proposal is sitting there undecided. It is NOT IN_REVIEW and must never be
// confused with it — IN_REVIEW means a DIRECTOR picked the ticket up (the button says "Take it on"),
// and moving an answered ticket there automatically would drain the BoD work queue into a tab that
// implies somebody is already handling it. Only the system writes AWAITING_DECISION; every way out
// of it is a human doing something.
export const COMPLAINT_STATUSES = ["OPEN", "AWAITING_DECISION", "IN_REVIEW", "RESOLVED", "CLOSED"] as const
export type ComplaintStatusKey = (typeof COMPLAINT_STATUSES)[number]

/**
 * The BoD inbox: every ticket nobody has claimed yet. GIDEON answering ANNOTATES a ticket, it does
 * not hand it to anyone, so an AWAITING_DECISION ticket is still unclaimed work and still belongs
 * here. GET /api/complaints?status=OPEN resolves to exactly this set, and that widening is the point
 * rather than a convenience: an older client — the iOS build in somebody's pocket — asks for OPEN
 * and must not quietly lose rows the day this status starts being written.
 */
export const COMPLAINT_INBOX_STATUSES = ["OPEN", "AWAITING_DECISION"] as const

/**
 * True while no human has taken the ticket on. Used on the way OUT: a BoD replying in the thread or
 * deciding a correction moves the ticket to IN_REVIEW from EITHER unclaimed status, so a ticket
 * GIDEON answered does not sit in "menunggu keputusan" forever after the decision has been made.
 *
 * The way IN is deliberately narrower and spelled `=== "OPEN"` at each of its two call sites: the
 * system may only lift a ticket out of OPEN, never out of IN_REVIEW/RESOLVED/CLOSED, so a director
 * who already owns a ticket is never pushed back out of it by GIDEON writing another message.
 */
export function isUnclaimedComplaintStatus(status: string): boolean {
  return status === "OPEN" || status === "AWAITING_DECISION"
}

export const SUBJECT_MIN = 4
export const SUBJECT_MAX = 140
export const BODY_MIN = 10
export const BODY_MAX = 4000

// Evidence photos, oldest-first, so the gallery order matches the order they were picked.
const ATTACHMENTS_INCLUDE = {
  orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }],
  select: { id: true, url: true, mimeType: true, size: true },
}
export const COMPLAINT_LIST_INCLUDE = {
  reporter: { select: { id: true, name: true, avatar: true } },
  attachments: ATTACHMENTS_INCLUDE,
  _count: { select: { messages: true } },
  // The two list markers. Prisma folds each of these relations into ONE extra query for the whole
  // page, not one per complaint, so this stays cheap without a denormalised column that would need a
  // backfill and would drift the first time some write forgot to touch it.
  //
  // `take: 1` because the row only needs to know THAT GIDEON wrote in the thread. The serializer
  // re-tests the author anyway, which is what lets the same derivation run against
  // COMPLAINT_DETAIL_INCLUDE below, where `messages` is the whole unfiltered thread.
  messages: {
    where: { author: { email: GIDEON_EMAIL } },
    take: 1,
    select: { id: true, author: { select: { email: true } } },
  },
  // Same shape of trick: pre-filtered here, filtered again in the serializer, so the detail include
  // (which carries every correction, decided ones included) gets the right answer from the same line.
  corrections: { where: { status: "PENDING" as const }, select: { id: true, status: true } },
}
export const COMPLAINT_DETAIL_INCLUDE = {
  reporter: { select: { id: true, name: true, avatar: true } },
  attachments: ATTACHMENTS_INCLUDE,
  resolvedBy: { select: { id: true, name: true } },
  // Proposed attendance fixes ride along with the thread, so the ticket detail screen has
  // everything it needs to show the "approve" card without a second round-trip.
  corrections: { include: ATTENDANCE_CORRECTION_INCLUDE, orderBy: { createdAt: "desc" as const } },
  messages: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true, avatar: true, email: true } } },
  },
}

type Person = { id: string; name: string; avatar: string | null }
type AttachmentRow = { id: string; url: string; mimeType: string; size: number }
type ComplaintRow = {
  id: string
  category: string
  subject: string
  evidenceUrl: string | null
  status: string
  lastMessageAt: Date
  resolvedAt: Date | null
  createdAt: Date
  reporterId: string
  reporter: Person
  attachments?: AttachmentRow[]
  _count?: { messages: number }
  // Present in both includes, with different contents on purpose — see COMPLAINT_LIST_INCLUDE.
  // Kept minimal and readonly so the detail row can narrow them to their richer shapes.
  messages?: readonly { author: { email: string | null } | null }[]
  corrections?: readonly { status: string }[]
}
type MessageRow = {
  id: string
  body: string
  fromReviewer: boolean
  fromGideon?: boolean
  createdAt: Date
  authorId: string
  // email rides along because it is the only thing telling GIDEON's own writes apart from a
  // director's — both sit on the reviewer side of the thread.
  author: Person & { email: string | null }
}
// Omit rather than intersect the two relations: the detail include carries strictly richer rows than
// the list include, and an intersection of two array types is a shape nothing can be `.map`ped over.
type ComplaintDetailRow = Omit<ComplaintRow, "messages" | "corrections"> & {
  resolvedBy: { id: string; name: string } | null
  messages: MessageRow[]
  corrections?: AttendanceCorrectionRow[]
}

/**
 * Serialize a complaint for a list view. The reporter's identity is shown to the reporter themselves and
 * to BoD — UNLESS the complaint is anonymous, in which case BoD see no reporter either (truly anonymous).
 */
export function serializeComplaint(c: ComplaintRow, viewerId: string, viewerIsBod: boolean) {
  const isMine = c.reporterId === viewerId
  const showReporter = isMine || viewerIsBod
  return {
    id: c.id,
    category: c.category,
    subject: c.subject,
    evidenceUrl: c.evidenceUrl,
    // A ticket can carry several photos now. Rows filed before that (and any include that skipped the
    // relation) fall back to the single legacy column so old tickets still show their evidence.
    attachments: c.attachments?.length
      ? c.attachments.map((a) => ({ id: a.id, url: a.url, mimeType: a.mimeType, size: a.size }))
      : c.evidenceUrl
        ? [{ id: `legacy-${c.id}`, url: c.evidenceUrl, mimeType: "image/jpeg", size: 0 }]
        : [],
    status: c.status,
    lastMessageAt: c.lastMessageAt,
    resolvedAt: c.resolvedAt,
    createdAt: c.createdAt,
    reporter: showReporter ? c.reporter : null,
    messageCount: c._count?.messages ?? 0,
    // -- List markers ------------------------------------------------------------------------
    // A ticket GIDEON had worked on used to look exactly like one nobody had touched: the payload
    // said only status/messageCount/lastMessageAt. These two say it on the row itself, and they are
    // deliberately INDEPENDENT of `status` — a director who already took a ticket on (so it reads
    // IN_REVIEW, not AWAITING_DECISION) still needs to see a proposal is sitting there undecided.
    gideonReplied: (c.messages ?? []).some((m) => m.author?.email === GIDEON_EMAIL),
    // At most one proposal is ever live per ticket — proposeAttendanceCorrection refuses a second and
    // the DB carries a partial unique index saying the same — so a boolean is the honest shape here,
    // not a count that can only ever read 0 or 1.
    pendingCorrection: (c.corrections ?? []).some((x) => x.status === "PENDING"),
    isMine,
    canReply: (isMine || viewerIsBod) && c.status !== "CLOSED",
    canManage: viewerIsBod, // status changes (review/resolve/close)
  }
}

/** Serialize a complaint with its full message thread (detail view). */
export function serializeComplaintDetail(c: ComplaintDetailRow, viewerId: string, viewerIsBod: boolean) {
  const base = serializeComplaint(c, viewerId, viewerIsBod)
  const messages = (c.messages ?? []).map((m) => ({
    id: m.id,
    body: m.body,
    fromReviewer: m.fromReviewer,
    createdAt: m.createdAt,
    author: m.author,
    mine: m.authorId === viewerId,
    // Reviewer replies are shown as a collective "BoD" so a reporter cannot tell which director
    // handled their complaint. GIDEON writes on that same side and must NOT inherit that anonymity:
    // an automated reading presented as a director's own conclusion is a claim nobody made.
    fromGideon: (m.author as { email?: string } | null)?.email === GIDEON_EMAIL,
  }))
  return {
    ...base,
    resolvedBy: c.resolvedBy ?? null,
    messages,
    corrections: (c.corrections ?? []).map(serializeAttendanceCorrection),
  }
}
