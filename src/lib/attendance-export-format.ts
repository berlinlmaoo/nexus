import type { AttendanceDayType } from "@/lib/attendance"

/**
 * The monthly attendance sheet's vocabulary: which letter a day gets, which colour that letter is
 * painted, the summary block under the grid, and how dates and the period are written.
 *
 * Shared by the xlsx the BoD downloads (GET /api/attendance/history?format=xlsx) and the live Google
 * Sheet (src/lib/attendance-sheet.ts). They are the same document in two places; if one said "I" and
 * the other "H" for an approved permit, payroll would be arguing with a spreadsheet. Change it here.
 */

export const ATTENDANCE_EXPORT_TIMEZONE = "Asia/Jakarta"

/** Hex RGB without '#', exactly as ExcelJS takes them (it ignores a missing alpha). */
export const ATTENDANCE_EXPORT_COLORS = {
  title: "FFD966",
  header: "9DC3E6",
  dateFill: "FCE4D6",
  dateFont: "7F6000",
  cellFont: "111111",
  summaryLabelFont: "3F3F3F",
  blank: "FFFFFF",
} as const

export type AttendanceExportCode = "H" | "C" | "S" | "DO" | "TK" | ""

export function attendanceExportCode(dayType: AttendanceDayType | null | undefined): AttendanceExportCode {
  switch (dayType) {
    case "PRESENT":
      return "H"
    case "LEAVE_APPROVED":
      return "C"
    case "SICK_APPROVED":
      return "S"
    // An approved permit is a working day with the manager's blessing, not a kind of absence: the
    // BoD wants it counted as HADIR on the sheet (17 Sep 2026), not a blue "I".
    case "PERMIT_APPROVED":
      return "H"
    case "DAY_OFF_APPROVED":
      return "DO"
    case "ABSENT":
      return "TK"
    default:
      return ""
  }
}

export function attendanceExportFill(code: string) {
  switch (code) {
    case "H":
      return "7CFC00"
    case "C":
      return "F9E27D"
    case "S":
      return "F5B041"
    case "DO":
      return "C39BD3"
    case "TK":
      return "FF5A36"
    default:
      return ATTENDANCE_EXPORT_COLORS.blank
  }
}

/**
 * The period's working days for one person: its calendar days minus their weekly-rest quota
 * (WorkspaceMember.dayOffQuota, default 4) — 31 days → 27, 30 → 26 (owner, 28 Sep 2026). This is the
 * "TOTAL HARI KERJA" row, and the board's Score column uses the same rule.
 */
export function exportWorkingDays(periodDays: number, dayOffQuota = 4) {
  return Math.max(0, periodDays - dayOffQuota)
}

/**
 * How the sheet and the xlsx exports show a person's days off (owner, 28 Sep 2026): a day without
 * attendance and without excuse (TK) first uses up whatever is left of the period's day-off quota and
 * is shown as DO; only once the quota is gone does a day show as TK. Days are taken in date order, and
 * days off the person actually took (DO already) count against the quota first.
 * Returns the codes plus the indexes that were converted, so a caller can annotate them.
 */
export function coverAbsencesWithDayOffQuota(codes: readonly string[], dayOffQuota = 4): { codes: string[]; covered: Set<number> } {
  let left = Math.max(0, dayOffQuota - codes.filter((c) => c === "DO").length)
  const covered = new Set<number>()
  const out = codes.map((c, i) => {
    if (c === "TK" && left > 0) { left -= 1; covered.add(i); return "DO" }
    return c
  })
  return { codes: out, covered }
}

/** The block under the grid, one row each, counted per person. TOTAL = working days (exportWorkingDays). */
export const ATTENDANCE_EXPORT_SUMMARY_ROWS = [
  { label: "HADIR", code: "H", fill: "7CFC00" },
  { label: "CUTI", code: "C", fill: "F9E27D" },
  { label: "SAKIT", code: "S", fill: "F5B041" },
  { label: "DAY OFF", code: "DO", fill: "C39BD3" },
  { label: "ABSENT", code: "TK", fill: "FF5A36" },
  { label: "TOTAL HARI KERJA", code: "TOTAL", fill: "FFD966" },
] as const

export function formatExportPeriod(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: ATTENDANCE_EXPORT_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

  return `${formatter.format(start)} - ${formatter.format(end)}`
}

export function formatExportDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ATTENDANCE_EXPORT_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date)
}
