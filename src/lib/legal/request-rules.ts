// Legal requests (owner, 14 Oct 2026): the pure half — board columns, what the requester is told, which file
// the requester may download, and the link's id in a URL. No imports, so tests can load it on its own.

/** The board's columns. A rejected request sits in DONE with a "Rejected" label. */
export const REQUEST_COLUMNS = ["TODO", "IN_PROGRESS", "DONE"] as const
export type RequestColumn = (typeof REQUEST_COLUMNS)[number]
export const isRequestColumn = (v: unknown): v is RequestColumn =>
  typeof v === "string" && (REQUEST_COLUMNS as readonly string[]).includes(v)

/**
 * Where a request stands, as the requester reads it (My Submissions). Only the requester's own document is
 * ever described, and only by these words:
 *   RECEIVED     sent, nobody has started
 *   IN_PROGRESS  Legal is on it (a draft exists, or the card was moved to In Progress)
 *   REVISION     the draft was revised (a version after the first)
 *   FINAL        final (or sent): the requester can download it
 *   SIGNED       the signed copy is in: the requester can download it
 *   DONE         moved to Done by hand without a signed document
 *   REJECTED     refused, with the reason
 */
export const REQUEST_STAGES = ["RECEIVED", "IN_PROGRESS", "REVISION", "FINAL", "SIGNED", "DONE", "REJECTED"] as const
export type RequestStage = (typeof REQUEST_STAGES)[number]

/** The stages that are pushed to the requester when a request reaches them (owner, 14 Oct 2026). */
export const PUSHED_STAGES: readonly RequestStage[] = ["IN_PROGRESS", "REVISION", "FINAL", "SIGNED", "REJECTED"]

export type LinkedDoc = { status: string; currentVersion: number; finalVersion: number | null; signedVersion: number | null } | null

export function requestStage(r: { column: string; rejectedAt: Date | string | null }, doc: LinkedDoc): RequestStage {
  if (r.rejectedAt) return "REJECTED"
  if (doc && doc.status !== "VOID") {
    if (doc.status === "SIGNED") return "SIGNED"
    if (doc.status === "FINAL" || doc.status === "SENT") return "FINAL"
    if (doc.currentVersion > 1) return "REVISION"
    return "IN_PROGRESS"
  }
  if (r.column === "DONE") return "DONE"
  if (r.column === "IN_PROGRESS") return "IN_PROGRESS"
  return "RECEIVED"
}

/**
 * The column a request moves to by itself when its document changes: SIGNED → Done; a document made from a
 * To Do card → In Progress. Otherwise it stays where people put it (manual drag is allowed).
 */
export function autoColumn(current: string, doc: LinkedDoc): RequestColumn {
  const col: RequestColumn = isRequestColumn(current) ? current : "TODO"
  if (!doc || doc.status === "VOID") return col
  if (doc.status === "SIGNED") return "DONE"
  if (col === "TODO") return "IN_PROGRESS"
  return col
}

/**
 * The one version the requester may download: the signed copy once SIGNED, the final version once FINAL or
 * SENT, nothing before (a draft is Legal's working copy).
 */
export function requesterFileVersion(doc: LinkedDoc): number | null {
  if (!doc) return null
  if (doc.status === "SIGNED") return doc.signedVersion ?? doc.finalVersion ?? doc.currentVersion
  if (doc.status === "FINAL" || doc.status === "SENT") return doc.finalVersion ?? doc.currentVersion
  return null
}

/** The URL id of a request link: "/f/legal-<token>". Form slugs are lowercase words, so the mixed-case token
 *  never collides with one; a miss still falls back to the form (the web asks the form API next). */
export const LINK_PREFIX = "legal-"
export const LINK_TOKEN = /^[A-Za-z0-9]{24}$/
export function tokenFromLinkId(id: string): string | null {
  const raw = id.startsWith(LINK_PREFIX) ? id.slice(LINK_PREFIX.length) : id
  return LINK_TOKEN.test(raw) ? raw : null
}
export const linkPath = (token: string) => `/f/${LINK_PREFIX}${token}`

/** Deadline filter of the board: overdue (before today, not Done), this week (next 7 days), none. */
export function deadlineBucket(deadline: Date | string | null, column: string, now: Date = new Date()): "overdue" | "week" | "later" | "none" {
  if (!deadline) return "none"
  const d = new Date(deadline)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (column !== "DONE" && d.getTime() < today.getTime()) return "overdue"
  if (d.getTime() < today.getTime() + 8 * 864e5) return "week"
  return "later"
}

/** A request's parent number as typed: trimmed, one line, at most 200 characters. Never looked up. */
export function cleanParentNumber(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 200) : ""
}
