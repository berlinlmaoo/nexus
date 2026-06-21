// Integrity (peer reports / "cepu") — shared constants + helpers. BETA: BoD-and-above only.
export { getUserOrgRole, isBodPlus } from "@/lib/feed" // reuse the org-role gate helpers

export const PEER_REPORT_CATEGORIES = [
  "SMOKING_INDOORS", "SMOKING_TOILET", "SAFETY_VIOLATION", "CLEANLINESS", "EQUIPMENT_MISUSE", "POLICY_OTHER",
] as const
export type PeerReportCategoryKey = (typeof PEER_REPORT_CATEGORIES)[number]

export const REASON_MIN = 10
export const REASON_MAX = 1000
export const DEFAULT_BOUNTY_XP = 20
export const DEFAULT_PENALTY_XP = 40

/** XP transfer on verify is gated behind this env flag (default OFF) until governance sign-off. */
export function peerReportXpEnabled(): boolean {
  const v = process.env.PEER_REPORT_XP_ENABLED
  return v === "1" || v === "true"
}

export const REPORT_INCLUDE = {
  reporter: { select: { id: true, name: true, avatar: true } },
  reportedUser: { select: { id: true, name: true, avatar: true } },
  reviewer: { select: { id: true, name: true } },
}

type ReportRow = {
  id: string
  category: string
  reason: string
  status: string
  reviewNote: string | null
  reviewedAt: Date | null
  reporterBountyXp: number
  reportedPenaltyXp: number
  xpAppliedAt: Date | null
  createdAt: Date
  reporterId: string
  reporter: { id: string; name: string; avatar: string | null }
  reportedUser: { id: string; name: string; avatar: string | null }
  reviewer: { id: string; name: string } | null
}

export function serializeReport(r: ReportRow, viewerId: string) {
  return {
    id: r.id,
    category: r.category,
    reason: r.reason,
    status: r.status,
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt,
    reporterBountyXp: r.reporterBountyXp,
    reportedPenaltyXp: r.reportedPenaltyXp,
    xpApplied: !!r.xpAppliedAt,
    createdAt: r.createdAt,
    reporter: r.reporter,
    reportedUser: r.reportedUser,
    reviewer: r.reviewer,
    isMine: r.reporterId === viewerId,
    // Conflict-of-interest: a BoD can't decide a report they filed.
    canDecide: r.status === "PENDING" && r.reporterId !== viewerId,
    canWithdraw: r.status === "PENDING" && r.reporterId === viewerId,
  }
}
