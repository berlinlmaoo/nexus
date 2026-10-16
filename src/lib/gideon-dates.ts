import { addDays, mondayOf, weekdayOf, wibDay } from "@/lib/calendar/core"

/**
 * Days GIDEON writes (owner, 16 Oct 2026, from an end-to-end test of "turn this doc into tasks, due Friday").
 *
 *  - A relative day ("Friday", "tomorrow", "next week") always ends as an explicit date, and the card and the
 *    reply both show it ("Fri 23 Oct"), so nobody has to work out which Friday was meant.
 *  - A weekday name equal to today means the NEXT one: said on a Friday, "due Friday" is next week's Friday.
 *    Only "today" means today.
 *
 * Every day is a WIB day (lib/calendar/core.ts). A due date without a time is stored at 00:00 UTC, the
 * convention of every task form.
 */

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, minggu: 0, ahad: 0,
  monday: 1, mon: 1, senin: 1,
  tuesday: 2, tue: 2, tues: 2, selasa: 2,
  wednesday: 3, wed: 3, rabu: 3,
  thursday: 4, thu: 4, thurs: 4, kamis: 4,
  friday: 5, fri: 5, jumat: 5,
  saturday: 6, sat: 6, sabtu: 6,
}

const ISO_DAY = /^(\d{4}-\d{2}-\d{2})(?:$|T00:00(?::00(?:\.000)?)?(?:Z|\+00:00)?$)/

/** The WIB day of `now` ("YYYY-MM-DD"). */
export function todayWib(now: Date = new Date()): string {
  return wibDay(now)
}

/**
 * "friday", "jumat depan", "tomorrow", "besok", "next week", "hari ini"… → the day it names, seen from
 * `today`; null for anything else (an ISO date included: the caller reads those as they are).
 *  - bare weekday: the next one, never today (today's name → a week from today);
 *  - "next <weekday>" / "<weekday> depan": that weekday in next week (Monday-based);
 *  - "this <weekday>" / "<weekday> ini": that weekday in this week, or the next one if it has passed or is today;
 *  - "next week" / "minggu depan" / "pekan depan": next week's Monday.
 */
export function resolveDayPhrase(text: string, today: string): string | null {
  const s = text.toLowerCase().replace(/[’']/g, "").replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim()
  if (!s) return null
  if (/^(today|hari ini|hr ini|sekarang)$/.test(s)) return today
  if (/^(tomorrow|besok|esok)$/.test(s)) return addDays(today, 1)
  if (/^(the )?day after tomorrow$|^lusa$/.test(s)) return addDays(today, 2)
  if (/^(next week|minggu depan|pekan depan)$/.test(s)) return addDays(mondayOf(today), 7)
  // "this week" names no single day ("minggu" alone is Sunday, "minggu ini" is this week).
  if (/^(this week|minggu ini|pekan ini)$/.test(s)) return null
  const m = /^(?:(next|this|on)\s+)?([a-z]+)(?:\s+(depan|ini))?$/.exec(s)
  if (!m) return null
  const wd = WEEKDAYS[m[2]]
  if (wd === undefined) return null
  const now = weekdayOf(today)
  const ahead = (wd - now + 7) % 7 || 7
  const which = m[1] === "next" || m[3] === "depan" ? "next" : m[1] === "this" || m[3] === "ini" ? "this" : "bare"
  if (which === "next") return addDays(mondayOf(today), 7 + ((wd + 6) % 7))
  if (which === "this") {
    const inWeek = addDays(mondayOf(today), (wd + 6) % 7)
    return inWeek > today ? inWeek : addDays(today, ahead)
  }
  return addDays(today, ahead)
}

/**
 * A due date as a model sends it: an ISO date or datetime, a relative day ("Friday", "besok"), null to clear,
 * or nothing. Date-only values land at 00:00 UTC like every task form.
 */
export function parseDueInput(value: unknown, now: Date = new Date()): Date | null | undefined {
  if (value === null) return null
  if (typeof value !== "string" || !value.trim()) return undefined
  const raw = value.trim()
  const iso = ISO_DAY.exec(raw)
  if (iso) return new Date(`${iso[1]}T00:00:00.000Z`)
  const day = resolveDayPhrase(raw, todayWib(now))
  if (day) return new Date(`${day}T00:00:00.000Z`)
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${raw}`)
  return parsed
}

/** "Fri 23 Oct" (en) / "Jum 23 Okt" (id); the year only when it is not the year of `today`. */
export function humanDay(day: string, lang: "en" | "id" = "en", today: string = todayWib()): string {
  const d = new Date(`${day}T12:00:00.000Z`)
  const sameYear = day.slice(0, 4) === today.slice(0, 4)
  const fmt = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "id-ID", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  })
  return fmt.format(d).replace(/,/g, "").replace(/\./g, "")
}

/** The prompt line that gives the model today's date and the weekday rule. */
export function datePromptLine(now: Date = new Date(), lang: "id" | "en" = "id"): string {
  const today = todayWib(now)
  const long = (l: "en" | "id") =>
    new Intl.DateTimeFormat(l === "en" ? "en-GB" : "id-ID", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${today}T12:00:00.000Z`))
  const sameWeekday = humanDay(addDays(today, 7), lang, today)
  return lang === "en"
    ? `[DATE] Today is ${long("en")} (WIB, ${today}). A weekday name means the NEXT one, never today: "${humanDay(today, "en", today).split(" ")[0]}" said today is ${humanDay(addDays(today, 7), "en", today)}. Only "today" means today. Whenever you set or mention a relative day, write the resolved date too (e.g. "${sameWeekday}"), and pass dates to NEXUS tools as YYYY-MM-DD.`
    : `[TANGGAL] Hari ini ${long("id")} (WIB, ${today}). Nama hari berarti hari itu yang BERIKUTNYA, bukan hari ini: "${humanDay(today, "id", today).split(" ")[0]}" yang diucapkan hari ini = ${humanDay(addDays(today, 7), "id", today)}. Hanya "hari ini" yang berarti hari ini. Tiap kali memakai atau menyebut hari relatif, tulis juga tanggalnya (mis. "${sameWeekday}"), dan kirim tanggal ke tool NEXUS sebagai YYYY-MM-DD.`
}
