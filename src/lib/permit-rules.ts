/**
 * Izin (PERMIT) — evidence rules.
 *
 * Izin used to be the cheapest way to erase an attendance penalty: no photo, no location, no time,
 * and no limit on filing it after the fact. "Lupa absen" typed at 5pm looked identical to a real
 * client meeting, and an approver had nothing to tell them apart with.
 *
 * Three rules now, all decided by Bagas on 2026-08-13:
 *
 * 1. PHOTO + LOCATION REQUIRED on self-submitted izin. Same evidence check-in already demands, so
 *    filing izin is no longer cheaper than just showing up.
 * 2. NO BACKDATING for staff — today or later only. Yesterday's missed check-in has to go through a
 *    BoD grant, where a human is on the hook for it.
 * 3. FILE IT AT CLOCK-IN TIME. Past shift start + the office's late grace it still goes through, but
 *    carries how many minutes late it was filed, and the approver sees that number. Deliberately not
 *    a hard block: a dead phone or a jam shouldn't force an unexcused absence — it should force a
 *    conversation.
 *
 * These live together because the request route enforces them and the form previews them; if the two
 * disagree, staff get a form that says yes and a server that says no.
 */
import { ATTENDANCE_TIMEZONE, minutesLateAgainstShift } from "@/lib/attendance"

/**
 * Minutes filed AFTER shift start. Floors at 0 — the shared `minutesLateAgainstShift` measures
 * lateness, so filing early reads as 0 rather than a negative number. That's all the approver needs:
 * the question is "how late", not "how early".
 */
export function reportDelayMinutes(
  submittedAt: Date,
  attendanceDate: Date,
  shiftStartTime: string,
  timeZone = ATTENDANCE_TIMEZONE,
): number {
  return minutesLateAgainstShift(submittedAt, attendanceDate, shiftStartTime, timeZone)
}

export type PermitTiming = {
  /** Minutes past shift start when filed; 0 means filed on time or early. */
  delayMinutes: number
  /** Past shift start + the office's grace period. */
  lateReport: boolean
  /** Human-readable, for both the form warning and the approver's row. */
  label: string
}

export function describePermitTiming(delayMinutes: number, lateGraceMinutes: number): PermitTiming {
  const lateReport = delayMinutes > lateGraceMinutes
  if (!lateReport) {
    return { delayMinutes, lateReport: false, label: "Dilaporin sebelum/pas jam masuk" }
  }
  const h = Math.floor(delayMinutes / 60)
  const m = delayMinutes % 60
  const span = h > 0 ? `${h} jam${m ? ` ${m} menit` : ""}` : `${m} menit`
  return { delayMinutes, lateReport: true, label: `Telat lapor ${span} dari jam masuk` }
}

/**
 * Is this date in the past, in attendance-local terms?
 *
 * Compared as calendar dates in the attendance timezone, not as instants: a permit filed at 01:00
 * WIB for "today" must not read as yesterday just because UTC hasn't rolled over.
 */
export function isBackdated(startDate: Date, now: Date = new Date(), timeZone = ATTENDANCE_TIMEZONE): boolean {
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  return key(startDate) < key(now)
}
