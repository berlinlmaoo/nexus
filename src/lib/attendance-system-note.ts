import { dayText, langFromRequest, recipientLang, type NotifLang } from "@/lib/notification-text"

/**
 * Notes the server itself writes onto attendance requests when the board changes a day from the
 * attendance board (override route) or Control Room (dayoffs route). They used to be stored as one
 * Indonesian sentence with the raw enum and an ISO date ("Status 2026-10-19 diubah jadi SICK oleh
 * direksi dari papan absensi."), and that sentence showed as-is in the English apps (visual QA
 * 24 Oct 2026). Stored rows keep the old text, so the wording is decided when a row is SENT, in the
 * reader's language, with a human date and status. A note a person typed never matches and is
 * returned unchanged.
 */

const STATUS: Record<string, { en: string; id: string }> = {
  PRESENT: { en: "Present", id: "Hadir" },
  PERMIT: { en: "Permit", id: "Izin" },
  LEAVE: { en: "Leave", id: "Cuti" },
  SICK: { en: "Sick", id: "Sakit" },
  DAY_OFF: { en: "Day off", id: "Day off" },
  ABSENT: { en: "Absent", id: "Alpha" },
}

function statusText(raw: string, lang: NotifLang): string {
  return STATUS[raw]?.[lang] ?? raw
}

function dateText(key: string, lang: NotifLang): string {
  // Noon WIB keeps the calendar day whatever the server's own timezone is.
  const d = new Date(`${key}T12:00:00+07:00`)
  if (Number.isNaN(d.getTime())) return key
  return dayText(d, lang, { weekday: "short", day: "numeric", month: "short" })
}

const OVERRIDE = /^Status (\d{4}-\d{2}-\d{2}) diubah jadi ([A-Z_]+) oleh direksi dari papan absensi\.$/
const REPLACED = /^Diganti jadi ([A-Z_]+) oleh direksi dari papan absensi\.$/
const REVIEWED = "Diubah oleh direksi dari papan absensi."
const CANCELLED_PRESENT = "Dibatalkan: hari ini diubah jadi Hadir oleh direksi."
const CONTROL_ROOM_DAY_OFF = "Day-off diatur oleh direksi (Control Room)"

/** The reader's wording of a server-written note; any other text comes back untouched. */
export function attendanceSystemNote<T extends string | null | undefined>(text: T, lang: NotifLang | null): T {
  if (typeof text !== "string" || !lang) return text
  const t = text.trim()
  let m = OVERRIDE.exec(t)
  if (m) {
    const [, key, action] = m
    return (lang === "id"
      ? `Diubah jadi ${statusText(action, "id")} untuk ${dateText(key, "id")} oleh direksi (papan absensi).`
      : `Changed to ${statusText(action, "en")} for ${dateText(key, "en")} by the board (Attendance board).`) as T
  }
  m = REPLACED.exec(t)
  if (m) {
    return (lang === "id"
      ? `Diganti jadi ${statusText(m[1], "id")} oleh direksi (papan absensi).`
      : `Replaced with ${statusText(m[1], "en")} by the board (Attendance board).`) as T
  }
  if (t === REVIEWED) return (lang === "id" ? REVIEWED : "Changed by the board (Attendance board).") as T
  if (t === CANCELLED_PRESENT) {
    return (lang === "id" ? CANCELLED_PRESENT : "Cancelled: the board changed this day to Present.") as T
  }
  if (t === CONTROL_ROOM_DAY_OFF) {
    return (lang === "id" ? "Day off diatur oleh direksi (Control Room)." : "Day off set by the board (Control Room).") as T
  }
  return text
}

/**
 * The language to word those notes in for an app: its explicit choice on this request, else the language
 * this person last chose (stored), else English (owner, 13 Oct 2026). null for the web, which receives the
 * stored text and words it itself at render time, in whatever language the page is showing
 * (apps/web/src/lib/server-text.ts).
 */
export async function attendanceNoteLang(headers: Headers, userId: string): Promise<NotifLang | null> {
  if ((headers.get("x-nexus-client") ?? "").startsWith("web")) return null
  return langFromRequest(headers) ?? (await recipientLang(userId)) ?? "en"
}
