/**
 * Cuti tahunan — eligibility and quota.
 *
 * Two rules, kept in one place because the request route, the "today" summary and the crew board all
 * have to agree on them. If they drift, staff get told they have days left and then get refused.
 *
 * 1. ELIGIBILITY — 12 months of service, counted from `WorkspaceMember.employmentStartDate`.
 *    Not filled in = not eligible. That's the honest default: NEXUS only launched in April 2026, so
 *    nothing already in the database measures how long anyone has actually worked here.
 *
 * 2. QUOTA — 12 days, reset on 1 January (Bagas's call, 2026-08-13). Counted per CALENDAR YEAR, and
 *    counted in DAYS, not requests, since one request can span several days.
 *
 * The two combine in a way worth stating: someone who qualifies mid-year gets the full 12 for what's
 * left of it, then a fresh 12 on 1 January. No pro-rata — decided, not overlooked.
 */
export const ANNUAL_LEAVE_DAYS = 12
export const ANNUAL_LEAVE_MIN_MONTHS = 12

export type LeaveEligibility =
  | { eligible: true; since: Date }
  | { eligible: false; reason: string; since: Date | null }

/** The date someone becomes eligible: exactly 12 months after they started. */
export function eligibleFrom(employmentStartDate: Date): Date {
  const d = new Date(employmentStartDate)
  d.setMonth(d.getMonth() + ANNUAL_LEAVE_MIN_MONTHS)
  return d
}

export function checkLeaveEligibility(
  employmentStartDate: Date | null | undefined,
  now: Date = new Date(),
): LeaveEligibility {
  if (!employmentStartDate) {
    return {
      eligible: false,
      since: null,
      reason: "Tanggal mulai kerja kamu belum diisi. Minta BoD isi dulu di halaman Attendance.",
    }
  }
  const from = eligibleFrom(employmentStartDate)
  if (now.getTime() < from.getTime()) {
    return {
      eligible: false,
      since: from,
      reason: `Cuti tahunan baru bisa dipakai setelah 12 bulan kerja — kamu berhak mulai ${from.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.`,
    }
  }
  return { eligible: true, since: from }
}

/** Calendar-year window [1 Jan, 31 Dec] containing `date`, in UTC to match how dates are stored. */
export function leaveYearRange(date: Date = new Date()): { start: Date; end: Date; year: number } {
  const year = date.getUTCFullYear()
  return {
    year,
    start: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
  }
}

/**
 * How many days of a request fall inside the given year.
 *
 * A request straddling New Year is charged to each year separately — otherwise 30 Dec–2 Jan would
 * either eat four days from one year's quota or slip past both.
 */
export function leaveDaysInYear(startDate: Date, endDate: Date, year: number): number {
  const { start, end } = leaveYearRange(new Date(Date.UTC(year, 5, 1)))
  const from = startDate.getTime() > start.getTime() ? startDate : start
  const to = endDate.getTime() < end.getTime() ? endDate : end
  if (from.getTime() > to.getTime()) return 0
  const dayMs = 24 * 60 * 60 * 1000
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.floor((b - a) / dayMs) + 1
}
