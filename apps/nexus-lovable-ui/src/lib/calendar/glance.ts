// Widget rules (Calendar phase 4, 0.1.7): what the Home Screen and Lock Screen widgets and the Apple Watch
// complications draw from ONE /api/calendar/glance snapshot, at any moment. The server sends the tasks once;
// the bars, "+N", "Coming up", the four lists, the rings and overdue are worked out here against "now", so a
// widget moves at WIB midnight (and when a task's time passes) without asking the server again.
//
// The web draws no widget. This file is the reference the iOS (Sources/Shared/CalendarGlance.swift) and
// Android ports are held to: glance.test.mjs writes fixtures/golden-glance/*.json and both ports must
// produce the same JSON. Keep it pure, keep it boring: no Intl, no locale collation, nothing a port cannot
// reproduce byte for byte.

export type GlanceScope = "me" | "division" | "all"

/** One task as /api/calendar/glance sends it (compact keys). */
export type GlanceEntry = {
  /** Null when masked. */
  id: string | null
  /** Only on a masked row: its stable key. */
  k?: string
  /** Title (≤ 60 characters); null when masked — the app says "Internal task" in its own language. */
  t: string | null
  /** WIB day "YYYY-MM-DD"; null for a task without a due date ("Someday"). */
  day: string | null
  /** WIB "HH:MM", or null for a date-only task. */
  time: string | null
  /** "#rrggbb": project colour (scope me), my division's card (division), the division (all). */
  c: string
  /** Project name. */
  p: string | null
  prio: string | null
  done: boolean
  m: boolean
  /** A calendar-only project: drawn, never open, never overdue. */
  ns?: true
}

export type GlanceSnapshot = {
  v: number
  tz: string
  userId: string
  /** "none" (not a company member) and "off" (outside the rollout) carry no tasks. */
  access: string
  scope: GlanceScope
  requestedScope: GlanceScope
  today: string
  now: string
  from: string | null
  to: string | null
  rules: { overdueWindowDays: number; urgentDays: number } | null
  items: GlanceEntry[]
  undated: GlanceEntry[]
  holidays: { day: string; name: string }[]
  truncated: boolean
}

// ── Time ───────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const WIB_MS = 7 * 3_600_000

/** The WIB day and minute of an instant: { day: "2026-10-05", hm: "12:00" }. */
export function wibClock(nowMs: number): { day: string; hm: string } {
  const s = new Date(nowMs + WIB_MS).toISOString()
  return { day: s.slice(0, 10), hm: s.slice(11, 16) }
}
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10)
}
/** b − a in days. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS)
}
/** 0 = Monday … 6 = Sunday. */
export function mondayIndex(day: string): number {
  return (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7
}
export function mondayOf(day: string): string {
  return addDays(day, -mondayIndex(day))
}
/** The instant a WIB day + "HH:MM" names, in ms. */
export function wibInstant(day: string, hm: string): number {
  return Date.parse(`${day}T${hm}:00.000Z`) - WIB_MS
}

const DEFAULT_RULES = { overdueWindowDays: 14, urgentDays: 2 }
const rulesOf = (s: GlanceSnapshot) => s.rules ?? DEFAULT_RULES

// ── One entry ──────────────────────────────────────────────────────────────────────────────────────

export const entryKey = (e: GlanceEntry): string => e.id ?? e.k ?? ""
/** Still work to do: not done, and in a project that has a status. */
export const entryOpen = (e: GlanceEntry): boolean => !e.done && !e.ns

export type Overdue = "none" | "recent" | "stale"

/**
 * "recent" = overdue for at most the window (drawn red), "stale" = older (stays on its date, grey). A
 * date-only task is overdue once its WIB day is over; a timed one from the minute after its time (widgets
 * redraw per minute at best, so "12:00" turns at 12:01).
 */
export function entryOverdue(e: GlanceEntry, day: string, hm: string, windowDays: number): Overdue {
  if (!entryOpen(e) || e.day === null) return "none"
  const over = e.day < day || (e.day === day && e.time !== null && e.time < hm)
  if (!over) return "none"
  return dayDiff(e.day, day) > windowDays ? "stale" : "recent"
}

const PRIORITY: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 }
const prioRank = (p: string | null) => PRIORITY[p ?? "MEDIUM"] ?? 2

/** Titles: lower-cased code units, then the raw string. Deliberately not a locale collation — three platforms must agree. */
export function titleOrder(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la !== lb) return la < lb ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Inside one day — the calendar's own order: work still to do first (overdue first), then done; timed by
 * time, then date-only; priority URGENT → NONE; titled before masked; title; key.
 */
export function compareInDay(day: string, hm: string, windowDays: number) {
  return (a: GlanceEntry, b: GlanceEntry): number => {
    const oa = entryOpen(a) ? 0 : 1
    const ob = entryOpen(b) ? 0 : 1
    if (oa !== ob) return oa - ob
    const la = entryOverdue(a, day, hm, windowDays) === "none" ? 1 : 0
    const lb = entryOverdue(b, day, hm, windowDays) === "none" ? 1 : 0
    if (la !== lb) return la - lb
    if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1
    if (a.time !== b.time) return (a.time ?? "") < (b.time ?? "") ? -1 : 1
    const pa = prioRank(a.prio)
    const pb = prioRank(b.prio)
    if (pa !== pb) return pa - pb
    if (a.m !== b.m) return a.m ? 1 : -1
    const t = titleOrder(a.t ?? "", b.t ?? "")
    if (t !== 0) return t
    const ka = entryKey(a)
    const kb = entryKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  }
}

/** Across days (lists): by day, tasks without a date last, then the in-day order. */
export function compareChrono(day: string, hm: string, windowDays: number) {
  const inDay = compareInDay(day, hm, windowDays)
  return (a: GlanceEntry, b: GlanceEntry): number => {
    if (a.day !== b.day) {
      if (a.day === null) return 1
      if (b.day === null) return -1
      return a.day < b.day ? -1 : 1
    }
    return inDay(a, b)
  }
}

/** What a widget draws for one task. */
export type Bar = {
  key: string
  /** Null when masked: the row opens the day, never the task. */
  id: string | null
  /** Null when masked ("Internal task"). */
  title: string | null
  day: string | null
  time: string | null
  color: string
  project: string | null
  priority: string | null
  /** Done, or a status-less project: drawn dimmed. */
  dim: boolean
  masked: boolean
  overdue: Overdue
}

function bar(e: GlanceEntry, day: string, hm: string, windowDays: number): Bar {
  return {
    key: entryKey(e),
    id: e.id,
    title: e.t,
    day: e.day,
    time: e.time,
    color: e.c,
    project: e.p,
    priority: e.prio,
    dim: !entryOpen(e),
    masked: e.m,
    overdue: entryOverdue(e, day, hm, windowDays),
  }
}

// ── Days ───────────────────────────────────────────────────────────────────────────────────────────

export type DayBars = {
  day: string
  /** Every task due that day (unique). */
  count: number
  /** Of those, still to do. */
  open: number
  /** The first `max` in the in-day order. */
  bars: Bar[]
  /** "+N": the rest. */
  more: number
  /** Something due that day is overdue within the window (a red mark). */
  overdue: boolean
  today: boolean
  /** Public holiday name, or null. */
  holiday: string | null
  /** Sunday — drawn red like a holiday. */
  sunday: boolean
  /** Inside the snapshot's window. Outside it the widget knows nothing, which is not the same as "no tasks". */
  covered: boolean
}

function dayBars(s: GlanceSnapshot, d: string, max: number, nowMs: number): DayBars {
  const { day, hm } = wibClock(nowMs)
  const w = rulesOf(s).overdueWindowDays
  const entries = s.items.filter((e) => e.day === d).sort(compareInDay(day, hm, w))
  return {
    day: d,
    count: entries.length,
    open: entries.filter(entryOpen).length,
    bars: entries.slice(0, max).map((e) => bar(e, day, hm, w)),
    more: Math.max(0, entries.length - max),
    overdue: entries.some((e) => entryOverdue(e, day, hm, w) === "recent"),
    today: d === day,
    holiday: s.holidays.find((h) => h.day === d)?.name ?? null,
    sunday: mondayIndex(d) === 6,
    covered: s.from !== null && s.to !== null && d >= s.from && d <= s.to,
  }
}

export type YearProgress = { day: number; days: number; percent: number }

/** "Day 278 · 76%": day of the year, and the share of the year gone (floored, so 100% only on 31 Dec). */
export function yearProgress(day: string): YearProgress {
  const y = +day.slice(0, 4)
  const n = dayDiff(`${y}-01-01`, day) + 1
  const days = dayDiff(`${y}-01-01`, `${y + 1}-01-01`)
  return { day: n, days, percent: Math.floor((n * 100) / days) }
}

export type MonthView = {
  /** "YYYY-MM" of today. */
  month: string
  today: string
  year: YearProgress
  /** 42 days, Monday first (6 weeks), like the calendar's grid. */
  cells: (DayBars & { inMonth: boolean })[]
}

/** The month that holds today, ≤ `maxBars` bars a day. */
export function monthView(s: GlanceSnapshot, nowMs: number, maxBars: number): MonthView {
  const { day } = wibClock(nowMs)
  const start = mondayOf(`${day.slice(0, 8)}01`)
  return {
    month: day.slice(0, 7),
    today: day,
    year: yearProgress(day),
    cells: Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i)
      return { ...dayBars(s, d, maxBars, nowMs), inMonth: d.slice(0, 7) === day.slice(0, 7) }
    }),
  }
}

/** Monday → Sunday of this week, ≤ `maxBars` bars a day. */
export function weekView(s: GlanceSnapshot, nowMs: number, maxBars: number): DayBars[] {
  const monday = mondayOf(wibClock(nowMs).day)
  return Array.from({ length: 7 }, (_, i) => dayBars(s, addDays(monday, i), maxBars, nowMs))
}

// ── Lists ──────────────────────────────────────────────────────────────────────────────────────────

export type BarList = { rows: Bar[]; more: number }

/**
 * "Coming up" / "Next": open tasks not yet due — today's whose time has not passed (date-only ones count
 * all day), then the days after — in order. `more` = the rest of the snapshot.
 */
export function upcoming(s: GlanceSnapshot, nowMs: number, limit: number): BarList {
  const { day, hm } = wibClock(nowMs)
  const w = rulesOf(s).overdueWindowDays
  const list = s.items
    .filter((e) => entryOpen(e) && e.day !== null && (e.day > day || (e.day === day && (e.time === null || e.time >= hm))))
    .sort(compareChrono(day, hm, w))
  return { rows: list.slice(0, limit).map((e) => bar(e, day, hm, w)), more: Math.max(0, list.length - limit) }
}

/** do = important and urgent · plan = important · act = urgent · later = neither ("Someday"). */
export type Quadrant = "do" | "plan" | "act" | "later"
export const QUADRANTS: Quadrant[] = ["do", "plan", "act", "later"]

/**
 * Eisenhower, for open tasks only (decision 7: these lists live in widgets alone). Important = URGENT or
 * HIGH. Urgent = URGENT, or due from today to `urgentDays − 1` days ahead (today and tomorrow by default),
 * or overdue within the window. Older overdue and undated tasks are urgent only when URGENT.
 */
export function quadrantOf(e: GlanceEntry, day: string, rules: { overdueWindowDays: number; urgentDays: number }): Quadrant {
  const important = e.prio === "URGENT" || e.prio === "HIGH"
  let urgent = e.prio === "URGENT"
  if (!urgent && e.day !== null) {
    const ahead = dayDiff(day, e.day)
    urgent = ahead < rules.urgentDays && ahead >= -rules.overdueWindowDays
  }
  if (important && urgent) return "do"
  if (important) return "plan"
  if (urgent) return "act"
  return "later"
}

export type QuadrantList = { quadrant: Quadrant; count: number; rows: Bar[] }

/** All four, every open task once (dated and undated), each list in order. Widgets show the first 2 / 4 / 8. */
export function quadrants(s: GlanceSnapshot, nowMs: number): QuadrantList[] {
  const { day, hm } = wibClock(nowMs)
  const rules = rulesOf(s)
  const all = [...s.items, ...s.undated].filter(entryOpen)
  const cmp = compareChrono(day, hm, rules.overdueWindowDays)
  return QUADRANTS.map((q) => {
    const list = all.filter((e) => quadrantOf(e, day, rules) === q).sort(cmp)
    return { quadrant: q, count: list.length, rows: list.map((e) => bar(e, day, hm, rules.overdueWindowDays)) }
  })
}

// ── Rings and one-liners ───────────────────────────────────────────────────────────────────────────

/** Today's tasks done / all (status-less projects left out: they can never be done). */
export function todayRing(s: GlanceSnapshot, nowMs: number): { done: number; total: number } {
  const { day } = wibClock(nowMs)
  const today = s.items.filter((e) => e.day === day && !e.ns)
  return { done: today.filter((e) => e.done).length, total: today.length }
}

/**
 * The inline line: "3 due today · next 19:00". `openToday` = still to do today (overdue ones included);
 * `next` = the first of `upcoming`, on any day.
 */
export function inlineLine(s: GlanceSnapshot, nowMs: number): { openToday: number; next: { day: string; time: string | null } | null } {
  const { day } = wibClock(nowMs)
  const first = upcoming(s, nowMs, 1).rows[0]
  return {
    openToday: s.items.filter((e) => e.day === day && entryOpen(e)).length,
    next: first ? { day: first.day as string, time: first.time } : null,
  }
}

// ── Freshness and redraws ──────────────────────────────────────────────────────────────────────────

/** A snapshot older than this is not shown as current ("Open NEXUS to refresh"). */
export const STALE_AFTER_MS = 2 * DAY_MS

export type Freshness = "empty" | "none" | "off" | "stale" | "fresh"

/**
 * empty = nothing saved (signed out, or never loaded) · none / off = the server said this account has no
 * calendar · stale = saved more than 2 days ago, or today is past the snapshot's window · fresh.
 */
export function freshness(s: GlanceSnapshot | null, savedAtMs: number, nowMs: number): Freshness {
  if (!s) return "empty"
  if (s.access === "none") return "none"
  if (s.access === "off") return "off"
  if (nowMs - savedAtMs > STALE_AFTER_MS) return "stale"
  const { day } = wibClock(nowMs)
  if (s.to === null || day > s.to || (s.from !== null && day < s.from)) return "stale"
  return "fresh"
}

/**
 * The moments after `nowMs` (within `horizonMs`) at which a widget's picture changes on its own: each
 * WIB midnight, the minute after an open timed task's time (it leaves "next" and turns overdue), and the
 * moment the snapshot turns stale. Sorted, unique, at most 48.
 */
export function redrawTimes(s: GlanceSnapshot, savedAtMs: number, nowMs: number, horizonMs: number): number[] {
  const end = nowMs + horizonMs
  const out = new Set<number>()
  let midnight = wibInstant(addDays(wibClock(nowMs).day, 1), "00:00")
  while (midnight <= end) {
    out.add(midnight)
    midnight += DAY_MS
  }
  for (const e of s.items) {
    if (!entryOpen(e) || e.day === null || e.time === null) continue
    const at = wibInstant(e.day, e.time) + 60_000
    if (at > nowMs && at <= end) out.add(at)
  }
  const stale = savedAtMs + STALE_AFTER_MS + 1
  if (stale > nowMs && stale <= end) out.add(stale)
  return [...out].sort((a, b) => a - b).slice(0, 48)
}
