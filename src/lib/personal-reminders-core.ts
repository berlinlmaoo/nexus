/**
 * Personal reminders, the pure part (no database): reading the time GIDEON or a client sends and checking a reminder.
 * Tested in personal-reminders.test.mjs. lib/personal-reminders.ts stores and fires them.
 */

export const REMINDER_TEXT_MAX = 280
/** At most this many reminders waiting per person (a runaway loop, not a real need). */
export const REMINDER_OPEN_MAX = 200
const MAX_AHEAD_MS = 366 * 86400e3

export type ReminderRefusalCode = "TEXT" | "TIME_PAST" | "TIME_FAR" | "TIME_BAD" | "TOO_MANY" | "NOT_FOUND"
export class ReminderRefusal extends Error {
  code: ReminderRefusalCode
  constructor(message: string, code: ReminderRefusalCode) {
    super(message)
    this.code = code
  }
}

/**
 * "2026-10-19T09:00" (no zone = WIB), "2026-10-19 09:00", a full ISO instant, or { date, time }. Null when it cannot
 * be read. A bare date means 09:00 WIB.
 */
export function parseRemindAt(at: unknown, date?: unknown, time?: unknown): Date | null {
  const s = typeof at === "string" ? at.trim() : ""
  const d = typeof date === "string" ? date.trim() : ""
  const t = typeof time === "string" ? time.trim() : ""
  const local = (day: string, hm: string) => {
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(hm)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !m) return null
    const hh = Number(m[1]), mm = Number(m[2] ?? "0")
    if (hh > 23 || mm > 59) return null
    return new Date(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`)
  }
  if (s) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return local(s, t || "09:00")
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}[:.]\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s)
    if (m) return local(m[1], m[2])
    // A full ISO instant with its zone only: Date() reads almost anything ("besok jam 9" → 2001).
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null
    const parsed = new Date(s)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (d) return local(d, t || "09:00")
  return null
}

/** Check a reminder exactly as creating it would (text, time), without writing anything. */
export function checkReminder(text: unknown, remindAt: Date | null, now: Date = new Date()): { text: string; remindAt: Date } {
  const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : ""
  if (!clean) throw new ReminderRefusal("Say what to be reminded about.", "TEXT")
  if (clean.length > REMINDER_TEXT_MAX) throw new ReminderRefusal(`A reminder is at most ${REMINDER_TEXT_MAX} characters.`, "TEXT")
  if (!remindAt || Number.isNaN(remindAt.getTime())) throw new ReminderRefusal("Give the time as YYYY-MM-DDTHH:MM (WIB).", "TIME_BAD")
  if (remindAt.getTime() < now.getTime() + 60_000) throw new ReminderRefusal("That time has already passed. Pick a time from a minute from now.", "TIME_PAST")
  if (remindAt.getTime() > now.getTime() + MAX_AHEAD_MS) throw new ReminderRefusal("Reminders go at most a year ahead.", "TIME_FAR")
  return { text: clean, remindAt }
}

