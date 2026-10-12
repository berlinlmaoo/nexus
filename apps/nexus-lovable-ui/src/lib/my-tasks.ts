/**
 * My Tasks grouping (QA S-04 / B01, 13 Oct 2026) — pure, so my-tasks.test.mjs runs it with plain node and the
 * iOS/Android ports can be checked against the same cases.
 *
 *   Overdue      open, past due: a date-only task once its WIB day is over, a timed task from its time.
 *   Due soon     open, due from now up to the end of the WIB day 3 days ahead.
 *   Later        open, due later, then open without a due date.
 *   Done         done in the last 7 days (completedAt, else updatedAt).
 *
 * Order inside a group = most urgent first: by due (oldest overdue first), then priority, then title.
 * Undated tasks (end of "Later") go by priority. Nothing is cut here: the screen shows the first N of
 * each group and a "Show all" button.
 */
export type MyTaskLike = {
  id: string
  title: string
  status?: string | null
  priority?: string | null
  dueDate?: string | null
  updatedAt?: string | null
  completedAt?: string | null
}

export type MyTaskGroupKey = "overdue" | "soon" | "later" | "done"
export type MyTaskGroup<T> = { key: MyTaskGroupKey; items: T[] }

const WIB_MS = 7 * 3_600_000
const DAY_MS = 86_400_000
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 }

export const isDoneStatus = (status?: string | null) => ["DONE", "COMPLETED", "COMPLETE"].includes((status || "").toUpperCase())

/** WIB day ("YYYY-MM-DD") of an instant. */
export const wibDay = (ms: number) => new Date(ms + WIB_MS).toISOString().slice(0, 10)

/** A due without a time: stored at 00:00 UTC (web/API date picks) or at 00:00 WIB (older clients). */
export function isDateOnly(ms: number): boolean {
  if (ms % DAY_MS === 0) return true
  const w = new Date(ms + WIB_MS)
  return w.getUTCHours() === 0 && w.getUTCMinutes() === 0
}

/** Past due at `now`: a date-only task once its WIB day is over, a timed task from its time. */
export function isOverdueAt(due: string | null | undefined, now: number): boolean {
  if (!due) return false
  const ms = Date.parse(due)
  if (Number.isNaN(ms)) return false
  return isDateOnly(ms) ? wibDay(ms) < wibDay(now) : ms < now
}

/** Whole WIB days late (0 = due today and already past). */
export function daysLate(due: string, now: number): number {
  return Math.round((Date.parse(`${wibDay(now)}T00:00:00Z`) - Date.parse(`${wibDay(Date.parse(due))}T00:00:00Z`)) / DAY_MS)
}

const rank = (p?: string | null) => PRIORITY_RANK[(p || "NONE").toUpperCase()] ?? 4

function byUrgency<T extends MyTaskLike>(a: T, b: T): number {
  const da = a.dueDate ? Date.parse(a.dueDate) : NaN
  const db = b.dueDate ? Date.parse(b.dueDate) : NaN
  const ha = !Number.isNaN(da), hb = !Number.isNaN(db)
  if (ha !== hb) return ha ? -1 : 1
  if (ha && hb) {
    // Same WIB day: priority first, then the time.
    const sa = wibDay(da), sb = wibDay(db)
    if (sa !== sb) return sa < sb ? -1 : 1
    if (rank(a.priority) !== rank(b.priority)) return rank(a.priority) - rank(b.priority)
    if (da !== db) return da - db
  } else if (rank(a.priority) !== rank(b.priority)) return rank(a.priority) - rank(b.priority)
  return a.title.localeCompare(b.title)
}

export function groupMyTasks<T extends MyTaskLike>(rows: T[], now: number, soonDays = 3): MyTaskGroup<T>[] {
  const soonEnd = Date.parse(`${wibDay(now + soonDays * DAY_MS)}T00:00:00Z`) - WIB_MS + DAY_MS // end of that WIB day
  const overdue: T[] = [], soon: T[] = [], later: T[] = [], done: T[] = []
  for (const x of rows) {
    if (isDoneStatus(x.status)) {
      const at = Date.parse(x.completedAt || x.updatedAt || "")
      if (!Number.isNaN(at) && now - at <= 7 * DAY_MS) done.push(x)
      continue
    }
    if (String(x.status || "").toUpperCase() === "CANCELLED") continue
    const ms = x.dueDate ? Date.parse(x.dueDate) : NaN
    if (Number.isNaN(ms)) later.push(x)
    else if (isOverdueAt(x.dueDate, now)) overdue.push(x)
    else if (ms < soonEnd) soon.push(x)
    else later.push(x)
  }
  overdue.sort(byUrgency); soon.sort(byUrgency); later.sort(byUrgency)
  done.sort((a, b) => Date.parse(b.completedAt || b.updatedAt || "") - Date.parse(a.completedAt || a.updatedAt || ""))
  const out: MyTaskGroup<T>[] = [
    { key: "overdue", items: overdue },
    { key: "soon", items: soon },
    { key: "later", items: later },
    { key: "done", items: done },
  ]
  return out.filter((g) => g.items.length > 0)
}

/** How many rows a group shows before "Show all". */
export const MY_TASKS_FIRST: Record<MyTaskGroupKey, number> = { overdue: 20, soon: 12, later: 12, done: 8 }
