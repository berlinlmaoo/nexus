/**
 * What one XP ledger row (XpTransaction) was for, in words — and whether the BoD may remove it.
 *
 * Pure: no imports and no I/O, so xp-reason.test.mjs loads it with plain node. The member record
 * (GET /api/members/[userId]/record) sends `kind`, `label`, `dateKey` and `detail` for every row, so
 * the web and the iPhone never parse reason keys themselves again; the iPhone maps `kind` to its own
 * (translated) words and falls back to `label`.
 *
 * The reason keys, as the writers produce them (grep awardXp / awardXpOnce / setLatePenalty):
 *   attendance:late:<YYYY-MM-DD>         −1 XP per minute late, capped at 120 (setLatePenalty / cron)
 *   attendance:nocheckout:<YYYY-MM-DD>   −25, no check-out that day (check-out route, offsite reject)
 *   attendance:alpha:<YYYY-MM-DD>        −150, absent without notice (TK — nightly cron)
 *   attendance:waiver:<YYYY-MM-DD>       0, the BoD's "clear penalty" marker — bookkeeping, never shown
 *   peer:report:<id>:penalty | :bounty   integrity report verdict (reported −, reporter +)
 *   admin:adjust | admin:adjust:<note · oleh Name>   BoD manual adjustment
 *   penalty                               a penalty quest (xpReward < 0), once per leaderboard period
 *   quest                                 a quest claimed
 *   bonus:zero-alpha:<period>             retired monthly no-absence bonus (old rows)
 *   task_done | priority_bonus | goal_milestone | streak   retired task/streak XP (old rows)
 */

export type XpReasonKind =
  | "late"
  | "nocheckout"
  | "alpha"
  | "waiver"
  | "peer_penalty"
  | "peer_bounty"
  | "admin_adjust"
  | "quest"
  | "quest_penalty"
  | "bonus"
  | "task_done"
  | "priority_bonus"
  | "goal_milestone"
  | "streak"
  | "other"

export interface XpReasonInfo {
  kind: XpReasonKind
  /** English, ready to show ("Late check-in · 45 min"). The iPhone translates by `kind` instead. */
  label: string
  /** The attendance day an attendance row is about (not the day it was written), else null. */
  dateKey: string | null
  /** The free text part: an adjustment's note, a bonus period, the late minutes. */
  detail: string | null
  /** An attendance penalty: tied to one member-day. */
  attendance: boolean
  /** Bookkeeping that moved nothing (the waiver marker): never listed. */
  hidden: boolean
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function dateOf(rest: string): string | null {
  const d = rest.slice(0, 10)
  return DATE_KEY.test(d) ? d : null
}

/**
 * Describe one ledger row. `amount` and `lateMinutes` only refine the late label: the ledger holds
 * −min(minutes, 120), so a real lateness above 120 minutes can only come from the attendance record.
 */
export function describeXpReason(reason: string, amount?: number | null, lateMinutes?: number | null): XpReasonInfo {
  const r = (reason ?? "").trim()
  const base = { dateKey: null as string | null, detail: null as string | null, attendance: false, hidden: false }

  if (r.startsWith("attendance:")) {
    const [, sub = "", ...rest] = r.split(":")
    const dateKey = dateOf(rest.join(":"))
    if (sub === "late") {
      const minutes = typeof lateMinutes === "number" && lateMinutes > 0
        ? lateMinutes
        : typeof amount === "number" && amount < 0 ? Math.abs(amount) : null
      const minText = minutes === null ? null : minutes >= 120 && !(typeof lateMinutes === "number" && lateMinutes > 0) ? "120+ min" : `${minutes} min`
      return { ...base, kind: "late", label: minText ? `Late check-in · ${minText}` : "Late check-in", dateKey, detail: minText, attendance: true }
    }
    if (sub === "nocheckout") return { ...base, kind: "nocheckout", label: "No check-out", dateKey, attendance: true }
    if (sub === "alpha") return { ...base, kind: "alpha", label: "Absent without notice (TK)", dateKey, attendance: true }
    if (sub === "waiver") return { ...base, kind: "waiver", label: "Penalty cleared for the day", dateKey, attendance: true, hidden: true }
    return { ...base, kind: "other", label: "Attendance", dateKey, attendance: dateKey !== null }
  }

  if (r.startsWith("peer:report:")) {
    if (r.endsWith(":bounty")) return { ...base, kind: "peer_bounty", label: "Integrity report · reward" }
    return { ...base, kind: "peer_penalty", label: "Integrity report · penalty" }
  }

  if (r === "admin:adjust" || r.startsWith("admin:adjust:")) {
    const note = r.slice("admin:adjust:".length).trim()
    const detail = r === "admin:adjust" || note === "" ? null : note
    return { ...base, kind: "admin_adjust", label: detail ? `Adjusted by the BoD · ${detail}` : "Adjusted by the BoD", detail }
  }

  if (r === "penalty") return { ...base, kind: "quest_penalty", label: "Penalty quest" }
  if (r === "quest" || r.startsWith("quest:")) return { ...base, kind: "quest", label: "Quest completed" }

  if (r.startsWith("bonus:")) {
    const [, what = "", ...rest] = r.split(":")
    const detail = rest.join(":") || null
    const label = what === "zero-alpha" ? "No-absence bonus" : "Bonus"
    return { ...base, kind: "bonus", label: detail ? `${label} · ${detail}` : label, detail }
  }

  switch (r) {
    case "task_done": return { ...base, kind: "task_done", label: "Task completed" }
    case "priority_bonus": return { ...base, kind: "priority_bonus", label: "Priority task bonus" }
    case "goal_milestone": return { ...base, kind: "goal_milestone", label: "Goal milestone" }
    case "streak": return { ...base, kind: "streak", label: "Daily streak" }
  }

  // Unknown key: show it as written rather than guess — better an odd label than a wrong one.
  return { ...base, kind: "other", label: r || "XP change", detail: null }
}

export type XpRefundDecision =
  | { ok: true; refund: number }
  | { ok: false; status: 400 | 409; code: "ALREADY_REFUNDED" | "NOT_A_DEDUCTION"; error: string }

/**
 * May this row be removed? The rules of POST /api/gamification/xp-transactions/[id]/refund, in the
 * order they are checked:
 *   1. already removed once (an XpRefund row exists for it)   → 409 ALREADY_REFUNDED
 *      (checked first: a removed row's amount is already 0, and "already removed" is the true answer)
 *   2. not a deduction (amount ≥ 0 — a gain, or the 0 XP waiver) → 400 NOT_A_DEDUCTION
 *   3. otherwise → the XP handed back = −amount (positive)
 */
export function xpRefundDecision(row: { amount: number; reason: string }, alreadyRefunded: boolean): XpRefundDecision {
  if (alreadyRefunded) {
    return { ok: false, status: 409, code: "ALREADY_REFUNDED", error: "Potongan XP ini sudah dihapus sebelumnya." }
  }
  if (!Number.isFinite(row.amount) || row.amount >= 0) {
    return { ok: false, status: 400, code: "NOT_A_DEDUCTION", error: "Ini bukan potongan XP — hanya potongan (XP minus) yang bisa dihapus." }
  }
  return { ok: true, refund: -row.amount }
}
