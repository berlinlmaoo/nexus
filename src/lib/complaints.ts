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

export const COMPLAINT_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"] as const
export type ComplaintStatusKey = (typeof COMPLAINT_STATUSES)[number]

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
}
type MessageRow = {
  id: string
  body: string
  fromReviewer: boolean
  fromGideon?: boolean
  createdAt: Date
  authorId: string
  author: Person
}
type ComplaintDetailRow = ComplaintRow & {
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
