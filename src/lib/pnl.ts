/**
 * What is left of the per-project P&L Dashboard. The dashboard, its API (/api/pnl/*) and the
 * enablePnlDashboard switch were retired on 11 Oct 2026 (owner; every P&L table was empty — see
 * lib/project-retired-flags.ts). The tables stay, and the Audit restore of an old recurring expense
 * still needs the cursor rule below (lib/deletion-restore-rules.ts).
 */

const pad2 = (n: number) => String(n).padStart(2, "0")

/** Month key ("YYYY-MM") helpers for the recurring cursor. */
export function pnlMonthKey(y: number, m: number) {
  return `${y}-${pad2(m)}`
}

/**
 * The cursor value that makes a recurring template start posting from "now": the CURRENT month
 * key once this month's posting day has been reached (already handled), else the PREVIOUS
 * month's key (so the materializer posts the current month when its day arrives — and never
 * backfills anything earlier). Used at creation AND at pause→resume.
 */
export function pnlRecurringCursorForNow(dayOfMonth: number, now: Date = new Date()) {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const dueDay = Math.min(Math.max(1, dayOfMonth), new Date(Date.UTC(y, m, 0)).getUTCDate())
  if (now.getUTCDate() >= dueDay) return pnlMonthKey(y, m)
  return m === 1 ? pnlMonthKey(y - 1, 12) : pnlMonthKey(y, m - 1)
}
