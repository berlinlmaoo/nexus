/**
 * The day rules for people who left (offboarding, owner 8 Oct 2026), shared by every recap: the crew
 * board and its xlsx/csv (GET /api/attendance/history), the live Google Sheet, Reports per crew and the
 * member record (both through classifyAttendanceDays).
 *
 * A person who left stays in the recaps of every period they were part of, with their absences counted
 * from their first day up to their LAST WORKING DAY (FormerMember.leftAt) and never after it: after that
 * day nothing is expected of them, so no red cell, no TK, no DO taken from their quota.
 *
 * No imports on purpose — src/lib/former-member-days.test.mjs loads this file with plain node.
 * Date keys are "YYYY-MM-DD" (the attendance date, 00:00 UTC of the Jakarta day).
 */

/** The first day a person can owe attendance: the day they joined, or an earlier first check-in. */
export function attendanceStartKey(joinKey: string, firstRecordKey: string | null | undefined): string {
  return firstRecordKey && firstRecordKey < joinKey ? firstRecordKey : joinKey
}

/**
 * Can `dateKey` be an absence for this person at all? Only from their first day (`startKey`) up to and
 * including their last working day (`leftKey`, null = still a member).
 */
export function owesAttendanceOn(dateKey: string, startKey: string, leftKey: string | null | undefined): boolean {
  return dateKey >= startKey && (!leftKey || dateKey <= leftKey)
}

/**
 * Does a person belong in the recap of a period that starts on `fromKey`? Yes while they are a member
 * (`leftKey` null) and when they were still there on its first day or later.
 */
export function belongsToPeriod(leftKey: string | null | undefined, fromKey: string): boolean {
  return !leftKey || leftKey >= fromKey
}

// Fixed, not ICU: the sheets are Indonesian whatever the server's locale data says.
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

/** "2026-10-10" → "keluar 10 Okt": the mark after a former member's name on the Indonesian sheets. */
export function leftNoteId(leftKey: string): string {
  const [, month, day] = leftKey.slice(0, 10).split("-").map(Number)
  return `keluar ${day} ${BULAN[month - 1] ?? ""}`.trim()
}

/** "BUDI" + "2026-10-10" → "BUDI (keluar 10 Okt)". No leftKey → the name as it was. */
export function withLeftNote(name: string, leftKey: string | null | undefined): string {
  return leftKey ? `${name} (${leftNoteId(leftKey)})` : name
}
