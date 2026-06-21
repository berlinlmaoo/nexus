// Complaint & Escalation channel — shared constants + serializers.
// Private, categorized chat between a staff member and the BoD. Confidential (BoD-only review) with an
// optional ANONYMOUS mode (reporter hidden even from BoD). Distinct from PeerReport (public + punitive).
export { getUserOrgRole, isBodPlus } from "@/lib/feed" // reuse the org-role gate helpers

export const COMPLAINT_CATEGORIES = [
  "ATTENDANCE", "EXP", "PAYROLL", "DAY_OFF", "OPERATIONAL", "HR", "LEADERSHIP", "OTHER",
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

export const COMPLAINT_LIST_INCLUDE = {
  reporter: { select: { id: true, name: true, avatar: true } },
  _count: { select: { messages: true } },
}
export const COMPLAINT_DETAIL_INCLUDE = {
  reporter: { select: { id: true, name: true, avatar: true } },
  resolvedBy: { select: { id: true, name: true } },
  messages: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true, avatar: true } } },
  },
}

type Person = { id: string; name: string; avatar: string | null }
type ComplaintRow = {
  id: string
  category: string
  subject: string
  anonymous: boolean
  confidential: boolean
  status: string
  lastMessageAt: Date
  resolvedAt: Date | null
  createdAt: Date
  reporterId: string
  reporter: Person
  _count?: { messages: number }
}
type MessageRow = {
  id: string
  body: string
  fromReviewer: boolean
  createdAt: Date
  authorId: string
  author: Person
}
type ComplaintDetailRow = ComplaintRow & {
  resolvedBy: { id: string; name: string } | null
  messages: MessageRow[]
}

/**
 * Serialize a complaint for a list view. The reporter's identity is shown to the reporter themselves and
 * to BoD — UNLESS the complaint is anonymous, in which case BoD see no reporter either (truly anonymous).
 */
export function serializeComplaint(c: ComplaintRow, viewerId: string, viewerIsBod: boolean) {
  const isMine = c.reporterId === viewerId
  const showReporter = isMine || (viewerIsBod && !c.anonymous)
  return {
    id: c.id,
    category: c.category,
    subject: c.subject,
    anonymous: c.anonymous,
    confidential: c.confidential,
    status: c.status,
    lastMessageAt: c.lastMessageAt,
    resolvedAt: c.resolvedAt,
    createdAt: c.createdAt,
    reporter: showReporter ? c.reporter : null,
    reporterHidden: !showReporter,
    messageCount: c._count?.messages ?? 0,
    isMine,
    canReply: (isMine || viewerIsBod) && c.status !== "CLOSED",
    canManage: viewerIsBod, // status changes (review/resolve/close)
  }
}

/** Serialize a complaint with its full message thread (detail view). */
export function serializeComplaintDetail(c: ComplaintDetailRow, viewerId: string, viewerIsBod: boolean) {
  const base = serializeComplaint(c, viewerId, viewerIsBod)
  const messages = (c.messages ?? []).map((m) => {
    // Reporter-side messages are hidden-author when the complaint is anonymous and the viewer is BoD.
    const hideAuthor = c.anonymous && viewerIsBod && !m.fromReviewer
    return {
      id: m.id,
      body: m.body,
      fromReviewer: m.fromReviewer,
      createdAt: m.createdAt,
      author: hideAuthor ? null : m.author,
      authorHidden: hideAuthor,
      mine: m.authorId === viewerId,
    }
  })
  return { ...base, resolvedBy: c.resolvedBy ?? null, messages }
}
