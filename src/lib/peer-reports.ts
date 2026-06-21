// Integrity (peer reports / "cepu") — shared constants + helpers.
// v2: ANY staff can file a report; only BoD review/decide. Verified violations are PUBLIC
// (Hall of Shame + company-wide announcement); reporter stays ANONYMOUS to everyone except BoD.
export { getUserOrgRole, isBodPlus } from "@/lib/feed" // reuse the org-role gate helpers

export const PEER_REPORT_CATEGORIES = [
  "SMOKING_INDOORS", "SMOKING_TOILET", "SAFETY_VIOLATION", "CLEANLINESS", "EQUIPMENT_MISUSE", "POLICY_OTHER",
] as const
export type PeerReportCategoryKey = (typeof PEER_REPORT_CATEGORIES)[number]

/** Human-readable category labels (for notifications + announcements). */
export const CATEGORY_LABEL: Record<string, string> = {
  SMOKING_INDOORS: "ngerokok di dalam ruangan",
  SMOKING_TOILET: "ngerokok di toilet",
  SAFETY_VIOLATION: "pelanggaran K3 / keamanan",
  CLEANLINESS: "kebersihan",
  EQUIPMENT_MISUSE: "salah pakai alat / aset",
  POLICY_OTHER: "pelanggaran kebijakan",
}
export const categoryLabel = (k: string) => CATEGORY_LABEL[k] ?? k

export const REASON_MIN = 10
export const REASON_MAX = 1000
export const REBUTTAL_MAX = 1000
export const DEFAULT_BOUNTY_XP = 20
export const DEFAULT_PENALTY_XP = 40

/** XP penalty on verify is ON by default now (product decision). Emergency kill-switch: PEER_REPORT_XP_DISABLED=1. */
export function peerReportXpEnabled(): boolean {
  return process.env.PEER_REPORT_XP_DISABLED !== "1"
}

export const REPORT_INCLUDE = {
  reporter: { select: { id: true, name: true, avatar: true } },
  reportedUser: { select: { id: true, name: true, avatar: true } },
  reviewer: { select: { id: true, name: true } },
}

type Person = { id: string; name: string; avatar: string | null }
type ReportRow = {
  id: string
  category: string
  reason: string
  evidenceUrl: string | null
  status: string
  rebuttal: string | null
  rebuttalAt: Date | null
  reviewNote: string | null
  reviewedAt: Date | null
  reportedPenaltyXp: number
  xpAppliedAt: Date | null
  createdAt: Date
  reporterId: string
  reportedUserId: string
  reporter: Person
  reportedUser: Person
  reviewer: { id: string; name: string } | null
}

/**
 * Serialize a report for a viewer. Reporter identity is hidden unless the viewer is BoD or the
 * reporter themselves (anonymity). `reason` (the free-text account) is only exposed to BoD or the
 * two parties — never to uninvolved viewers.
 */
export function serializeReport(r: ReportRow, viewerId: string, viewerIsBod: boolean) {
  const isReporter = r.reporterId === viewerId
  const isReported = r.reportedUserId === viewerId
  const showReporter = viewerIsBod || isReporter
  const showReason = viewerIsBod || isReporter || isReported
  return {
    id: r.id,
    category: r.category,
    reason: showReason ? r.reason : null,
    evidenceUrl: showReason ? r.evidenceUrl : null,
    status: r.status,
    rebuttal: r.rebuttal,
    rebuttalAt: r.rebuttalAt,
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt,
    reportedPenaltyXp: r.reportedPenaltyXp,
    xpApplied: !!r.xpAppliedAt,
    createdAt: r.createdAt,
    reporter: showReporter ? r.reporter : null,
    reporterHidden: !showReporter,
    reportedUser: r.reportedUser,
    reviewer: r.reviewer,
    isMine: isReporter,
    isAgainstMe: isReported,
    canDecide: viewerIsBod && r.status === "PENDING" && !isReporter, // BoD-only + conflict-of-interest
    canWithdraw: r.status === "PENDING" && isReporter,
    canRebut: isReported && r.status === "PENDING",
  }
}

/** Minimal PUBLIC shape for the Hall of Shame — name + category + date only. No reporter, no reason. */
export function serializeHallOfShame(r: { id: string; category: string; reviewedAt: Date | null; createdAt: Date; reportedUser: Person }) {
  return {
    id: r.id,
    category: r.category,
    at: r.reviewedAt ?? r.createdAt,
    reportedUser: r.reportedUser,
  }
}
