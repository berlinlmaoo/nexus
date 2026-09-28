/**
 * Extra day off ("DayOffBonus") — the pure half: period math, the effective-quota sum, validation
 * and the push copy. No imports and no I/O, so day-off-bonus.test.mjs loads it with plain node; the
 * database half lives in day-off-usage.ts (effectiveDayOffQuotas) and the route in
 * /api/attendance/day-off-bonus.
 *
 * Owner decision (Berlin, 28 Sep 2026): the BoD can give selected people X extra day-off days that
 * count in ONE attendance period only (28th → 27th, keyed "YYYY-MM" = the month the period ends in,
 * exactly like attendancePeriodKey). The first use was staff who worked a 3-day event. Days not used
 * by the 27th expire with the period — nothing carries over, because nothing is stored per person
 * except the grant row, and every reader asks for the period of the day in question.
 *
 *   effective quota(person, period) = WorkspaceMember.dayOffQuota ?? 4  +  Σ days of that person's
 *                                     non-revoked grants for that period
 *
 * What the extra days change: the DAY_OFF cap on self-filed requests, every displayed "x/y" and
 * "sisa", and the working-days target (TOTAL HARI KERJA = period days − effective quota). What they
 * do NOT change: the absence cron. A missed check-in or a >120-minute late arrival still writes its
 * DAY_OFF cut exactly as before — it just lands on a bigger allowance.
 */

/** Cut-off day of the attendance period — must equal ATTENDANCE_CUTOFF_DAY in lib/attendance.ts. */
export const BONUS_PERIOD_CUTOFF_DAY = 27
export const DAY_OFF_BONUS_MIN_DAYS = 1
export const DAY_OFF_BONUS_MAX_DAYS = 31
export const DAY_OFF_BONUS_REASON_MAX = 200
/** One request may name at most this many people (a whole crew is ~50). */
export const DAY_OFF_BONUS_MAX_PEOPLE = 200

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isPeriodKey(value: unknown): value is string {
  return typeof value === "string" && PERIOD_RE.test(value)
}

/** "2026-10" shifted by `delta` periods (months): shiftPeriodKey("2026-01", -1) = "2025-12". */
export function shiftPeriodKey(periodKey: string, delta: number): string {
  const m = PERIOD_RE.exec(periodKey)
  if (!m) throw new Error(`not a period key: ${periodKey}`)
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta
  const y = Math.floor(index / 12)
  const mo = index - y * 12 + 1
  return `${y}-${String(mo).padStart(2, "0")}`
}

/** Which period ("YYYY-MM") an attendance date key ("YYYY-MM-DD") falls in — same rule as attendancePeriodKey. */
export function periodKeyOfDateKey(dateKey: string, cutoffDay = BONUS_PERIOD_CUTOFF_DAY): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const base = `${year}-${String(month).padStart(2, "0")}`
  return day > cutoffDay ? shiftPeriodKey(base, 1) : base
}

/** First and last attendance date (00:00 UTC) of a period — same as attendancePeriodRange. */
export function periodBounds(periodKey: string, cutoffDay = BONUS_PERIOD_CUTOFF_DAY) {
  const [year, month] = periodKey.split("-").map(Number)
  return {
    start: new Date(Date.UTC(year, month - 2, cutoffDay + 1)),
    end: new Date(Date.UTC(year, month - 1, cutoffDay)),
  }
}

/**
 * The periods a grant may target, given the period today is in: the previous one (the event may
 * have been last week, and payroll for it is not closed yet), the current one, and the next one.
 * Anything older is refused — payroll for it is gone — and anything further ahead is a typo.
 */
export function grantablePeriods(currentPeriodKey: string): string[] {
  return [shiftPeriodKey(currentPeriodKey, -1), currentPeriodKey, shiftPeriodKey(currentPeriodKey, 1)]
}

export type GrantPeriodCheck = { ok: true } | { ok: false; code: "PERIOD_TOO_OLD" | "PERIOD_TOO_FAR" | "PERIOD_INVALID" }

export function checkGrantPeriod(periodKey: unknown, currentPeriodKey: string): GrantPeriodCheck {
  if (!isPeriodKey(periodKey)) return { ok: false, code: "PERIOD_INVALID" }
  const [prev, , next] = grantablePeriods(currentPeriodKey)
  if (periodKey < prev) return { ok: false, code: "PERIOD_TOO_OLD" }
  if (periodKey > next) return { ok: false, code: "PERIOD_TOO_FAR" }
  return { ok: true }
}

export interface BonusRowLike {
  userId: string
  periodKey: string
  days: number
  revokedAt?: Date | string | null
}

/** Σ days of the non-revoked grants per `${userId}|${periodKey}`. Revoked rows count for nothing. */
export function sumBonusDays(rows: ReadonlyArray<BonusRowLike>): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.revokedAt) continue
    if (!Number.isFinite(r.days) || r.days <= 0) continue
    const key = `${r.userId}|${r.periodKey}`
    out.set(key, (out.get(key) ?? 0) + Math.trunc(r.days))
  }
  return out
}

export interface EffectiveDayOffQuota {
  /** WorkspaceMember.dayOffQuota, or the default when unset. */
  base: number
  /** Σ extra days granted for this period (0 when none). */
  bonus: number
  /** base + bonus — the allowance for this period. */
  quota: number
}

/** The one formula. `base` null/undefined = the workspace default. */
export function combineDayOffQuota(base: number | null | undefined, bonusDays: number, defaultQuota = 4): EffectiveDayOffQuota {
  const b = typeof base === "number" && Number.isFinite(base) ? base : defaultQuota
  const x = Number.isFinite(bonusDays) && bonusDays > 0 ? Math.trunc(bonusDays) : 0
  return { base: b, bonus: x, quota: b + x }
}

const ID_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "2026-10" → "28 Sep–27 Okt" (Indonesian, for the push) or "28 Sep–27 Oct" (English). */
export function periodLabel(periodKey: string, lang: "id" | "en" = "id"): string {
  const { start, end } = periodBounds(periodKey)
  const names = lang === "id" ? ID_MONTHS : EN_MONTHS
  return `${start.getUTCDate()} ${names[start.getUTCMonth()]}–${end.getUTCDate()} ${names[end.getUTCMonth()]}`
}

/** The in-app + push copy the person receives (Indonesian, like every push). */
export function bonusGrantNotice(days: number, periodKey: string, reason: string) {
  // The sentence goes on after the reason, so a reason typed with its own full stop would read "..".
  const r = reason.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "")
  return {
    title: "Extra day off",
    message: `Kamu dapat ${days} extra day off untuk periode ${periodLabel(periodKey, "id")}${r ? ` — ${r}` : ""}. Hangus setelah periode itu.`,
  }
}
