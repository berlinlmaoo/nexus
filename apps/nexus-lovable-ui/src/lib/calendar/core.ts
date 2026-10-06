/**
 * Calendar — the rules every client applies to what /api/calendar/** returns: filters, dots, the day
 * panel's tree (per division / per person), the week "People" table and overdue. Pure and import-free:
 * the golden test (core.test.mjs) runs it with plain node, and the iOS (CalendarCore.swift) and Android
 * ports must produce the same golden files. The server decides who may see what and where a task sits
 * (placements); nothing here changes that.
 *
 * Owner's decisions (plan "Rencana Kalender NEXUS", numbered rules in section 10):
 *   - a task is under the Bagan cards of its PICs; without a PIC in the Bagan, under its project's
 *     division (placedBy "project") — there is no "no PIC" corner and no grey dot (10.5, 10.8);
 *   - overdue up to `overdueWindowDays` is shown as overdue; older stays on its date, grey (10.17);
 *   - counts are unique tasks: a task under two divisions counts once in the total (10.7);
 *   - order everywhere = Bagan canvas order (`rank`) (10.9).
 */

// ── Shapes (as the server sends them) ─────────────────────────────────────────────────────────────

export type CalAccess = "none" | "off" | "all" | "all_except_private" | "masked_foreign" | "projects"

export type CalUnit = {
  id: string; name: string; kind: string; parentId: string | null
  rank: number; depth: number; sectionId: string
  color: string; colorDark: string; logoUrl: string | null; leadUserId: string | null
}
export type CalPerson = {
  userId: string; name: string | null; avatar: string | null; role: string
  unitIds: string[]; homeUnitIds: string[]; reportsTo: Record<string, string>
}
export type CalStructure = {
  v: number; version: string | null; access: CalAccess
  me: { userId: string; role: string | null; homeUnitIds: string[] } | null
  units: CalUnit[]; people: CalPerson[]
}
export type CalItem = {
  key: string; id: string | null; masked: boolean; title: string | null
  day: string; time: string | null; due: string
  status: string; done: boolean; noStatus: boolean; priority: string | null
  project: { id: string; name: string; color: string } | null
  linkedProjectIds: string[]; parent: { id: string; title: string } | null
  assigneeIds: string[]; placements: { unitId: string; userIds: string[] }[]
  placedBy: "pic" | "project"; unplacedIds: string[]
  canEdit: boolean; editProjectId: string | null
}
export type CalRules = { overdueWindowDays: number; urgentDays: number }
export type CalItemsResponse = {
  v: number; tz: string; today: string; now: string; from: string; to: string; access: CalAccess
  structureVersion: string | null; rules: CalRules | null; items: CalItem[]
  people: Record<string, { name: string | null; avatar: string | null }>
  holidays: { day: string; name: string }[]; truncated: boolean
}

// ── Days ───────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10)
}
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
/** The 42 days (6 weeks, Monday first) of the month grid that holds `day`. */
export function monthGrid(day: string): string[] {
  const start = mondayOf(`${day.slice(0, 8)}01`)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}
/** First and last day of the grid — the range to ask /items for (≤ 42 days). */
export function gridRange(day: string): { from: string; to: string } {
  const g = monthGrid(day)
  return { from: g[0], to: g[41] }
}
export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}
export function shiftMonth(day: string, n: number): string {
  const y = +day.slice(0, 4)
  const m = +day.slice(5, 7) - 1 + n
  const first = new Date(Date.UTC(y, m, 1))
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const d = Math.min(+day.slice(8, 10), last)
  return `${first.toISOString().slice(0, 8)}${String(d).padStart(2, "0")}`
}

// ── Overdue ────────────────────────────────────────────────────────────────────────────────────────

/**
 * "none", "recent" (overdue for at most `windowDays` — drawn as overdue) or "stale" (older — stays on
 * its date, drawn grey until it is done). A date-only task is overdue once its WIB day is over; a task
 * with a time from that moment. Done tasks and tasks of status-less projects are never overdue.
 */
export function overdueState(item: CalItem, today: string, nowMs: number, windowDays: number): "none" | "recent" | "stale" {
  if (item.done || item.noStatus || item.status === "CANCELLED") return "none"
  const over = item.time === null ? item.day < today : Date.parse(item.due) < nowMs
  if (!over) return "none"
  return dayDiff(item.day, today) > windowDays ? "stale" : "recent"
}

/** Still work to do: not done and in a project that has a status. */
export const isOpen = (i: CalItem) => !i.done && !i.noStatus

// ── The Bagan, indexed ─────────────────────────────────────────────────────────────────────────────

export type CalIndex = {
  units: CalUnit[]
  byId: Map<string, CalUnit>
  /** Children in Bagan order (groups included). */
  children: Map<string, CalUnit[]>
  /** The top card (rank order), or null for an empty Bagan. */
  top: CalUnit | null
  person: Map<string, CalPerson>
  ancestors: (id: string) => string[]
  subtree: (ids: string[]) => Set<string>
}

export function indexStructure(units: CalUnit[], people: CalPerson[]): CalIndex {
  const sorted = [...units].sort((a, b) => a.rank - b.rank)
  const byId = new Map(sorted.map((u) => [u.id, u]))
  const children = new Map<string, CalUnit[]>()
  for (const u of sorted) if (u.parentId && byId.has(u.parentId)) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u])
  const ancestors = (id: string) => {
    const out: string[] = []
    const seen = new Set([id])
    for (let p = byId.get(id)?.parentId ?? null; p && byId.has(p) && !seen.has(p); p = byId.get(p)?.parentId ?? null) {
      out.push(p)
      seen.add(p)
    }
    return out
  }
  const subtree = (ids: string[]) => {
    const out = new Set<string>()
    const stack = [...ids]
    while (stack.length) {
      const id = stack.pop()!
      if (out.has(id) || !byId.has(id)) continue
      out.add(id)
      stack.push(...(children.get(id) ?? []).map((k) => k.id))
    }
    return out
  }
  return {
    units: sorted, byId, children,
    top: sorted.find((u) => !u.parentId && u.kind !== "GROUP") ?? sorted[0] ?? null,
    person: new Map(people.map((p) => [p.userId, p])),
    ancestors, subtree,
  }
}

/**
 * Where a unit shows at a focus level: the child of `focusId` on the way down to it (a group counts as
 * one), `focusId` itself when the unit IS the focus, null when it is not under the focus.
 */
export function bucketOf(ix: CalIndex, unitId: string, focusId: string): string | null {
  if (unitId === focusId) return focusId
  const up = ix.ancestors(unitId)
  const at = up.indexOf(focusId)
  if (at < 0) return null
  return at === 0 ? unitId : up[at - 1]
}

// ── Filters ────────────────────────────────────────────────────────────────────────────────────────

export type CalScope = "all" | "me" | "division"
export type CalFilters = {
  scope: CalScope
  /** Units picked (a group = everything in it); a task matches when one of its placements is under one. */
  units: string[]
  people: string[]
  projects: string[]
  priorities: string[]
  hideDone: boolean
  overdueOnly: boolean
}
export const NO_FILTERS: CalFilters = { scope: "all", units: [], people: [], projects: [], priorities: [], hideDone: false, overdueOnly: false }

/** Everything that narrows the list, the scope included. */
export function activeFilterCount(f: CalFilters): number {
  return (f.scope !== "all" ? 1 : 0) + (f.units.length ? 1 : 0) + (f.people.length ? 1 : 0) + (f.projects.length ? 1 : 0)
    + (f.priorities.length ? 1 : 0) + (f.hideDone ? 1 : 0) + (f.overdueOnly ? 1 : 0)
}

/**
 * The count on the Filters button. Everyone / Mine / My division is the view's scope, not a filter
 * (owner, round 2): it has its own switch and is never counted here.
 */
export function filterCount(f: CalFilters): number {
  return activeFilterCount({ ...f, scope: "all" })
}

/** "Reset filters": every filter off, the scope kept as it is. */
export function clearFilters(f: CalFilters): CalFilters {
  return { ...NO_FILTERS, scope: f.scope }
}

export type FilterContext = { ix: CalIndex; meId: string | null; myHomes: string[]; today: string; nowMs: number; windowDays: number }

export function filterItems(items: CalItem[], f: CalFilters, c: FilterContext): CalItem[] {
  const mine = f.scope === "division" ? c.ix.subtree(c.myHomes) : null
  const picked = f.units.length ? c.ix.subtree(f.units) : null
  const people = f.people.length ? new Set(f.people) : null
  const projects = f.projects.length ? new Set(f.projects) : null
  const prios = f.priorities.length ? new Set(f.priorities) : null
  return items.filter((i) => {
    if (f.scope === "me" && !(c.meId && i.assigneeIds.includes(c.meId))) return false
    if (mine && !i.placements.some((p) => mine.has(p.unitId))) return false
    if (picked && !i.placements.some((p) => picked.has(p.unitId))) return false
    if (people && !i.assigneeIds.some((id) => people.has(id))) return false
    if (projects && !(i.project && (projects.has(i.project.id) || i.linkedProjectIds.some((id) => projects.has(id))))) return false
    if (prios && !(i.priority && prios.has(i.priority))) return false
    if (f.hideDone && i.done) return false
    if (f.overdueOnly && overdueState(i, c.today, c.nowMs, c.windowDays) === "none") return false
    return true
  })
}

/** Items with at least one placement under the focus (all of them at the top). */
export function underFocus(items: CalItem[], ix: CalIndex, focusId: string): CalItem[] {
  if (ix.top && focusId === ix.top.id) return items
  const sub = ix.subtree([focusId])
  return items.filter((i) => i.placements.some((p) => sub.has(p.unitId)))
}

// ── Grid ───────────────────────────────────────────────────────────────────────────────────────────

export type Dot = {
  /** The unit at the focus level (or "other" for a task placed nowhere). */
  unitId: string
  /** Filled = at least one task still to do; ring = only done / status-less tasks. */
  filled: boolean
  count: number
}

export type DayCell = {
  day: string
  /** Unique tasks that day (after filters and focus). */
  count: number
  dots: Dot[]
  /** A task overdue within the window is due that day (incl. a timed task today whose time has passed). */
  overdue: boolean
}

export function byDay(items: CalItem[]): Map<string, CalItem[]> {
  const m = new Map<string, CalItem[]>()
  for (const i of items) m.set(i.day, [...(m.get(i.day) ?? []), i])
  return m
}

export function dayCell(day: string, items: CalItem[], ix: CalIndex, focusId: string, today: string, nowMs: number, windowDays: number): DayCell {
  const dots = new Map<string, Dot>()
  for (const i of items) {
    const buckets = new Set(i.placements.map((p) => bucketOf(ix, p.unitId, focusId)).filter((b): b is string => b !== null))
    if (buckets.size === 0 && i.placements.length === 0) buckets.add("other")
    for (const b of buckets) {
      const d = dots.get(b) ?? { unitId: b, filled: false, count: 0 }
      d.count++
      if (isOpen(i)) d.filled = true
      dots.set(b, d)
    }
  }
  const rank = (id: string) => (id === "other" ? Number.MAX_SAFE_INTEGER : (ix.byId.get(id)?.rank ?? 0))
  return {
    day,
    count: items.length,
    dots: [...dots.values()].sort((a, b) => rank(a.unitId) - rank(b.unitId)),
    overdue: items.some((i) => overdueState(i, today, nowMs, windowDays) === "recent"),
  }
}

export type LegendEntry = { unitId: string; count: number }

/** One chip per unit at the focus level with tasks in `items` (unique count), in Bagan order. */
export function legend(items: CalItem[], ix: CalIndex, focusId: string): LegendEntry[] {
  const count = new Map<string, number>()
  for (const i of items) {
    const buckets = new Set(i.placements.map((p) => bucketOf(ix, p.unitId, focusId)).filter((b): b is string => b !== null))
    if (buckets.size === 0 && i.placements.length === 0) buckets.add("other")
    for (const b of buckets) count.set(b, (count.get(b) ?? 0) + 1)
  }
  const rank = (id: string) => (id === "other" ? Number.MAX_SAFE_INTEGER : (ix.byId.get(id)?.rank ?? 0))
  return [...count.entries()].map(([unitId, n]) => ({ unitId, count: n })).sort((a, b) => rank(a.unitId) - rank(b.unitId))
}

// ── Day panel ──────────────────────────────────────────────────────────────────────────────────────

const PRIORITY: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 }

/**
 * Inside one unit: work still to do first (overdue first), then done; within each, timed by time, then
 * date-only; then priority URGENT → NONE; titled before masked; title A–Z; key.
 */
export function compareInDay(today: string, nowMs: number, windowDays: number) {
  return (a: CalItem, b: CalItem): number => {
    const oa = isOpen(a) ? 0 : 1
    const ob = isOpen(b) ? 0 : 1
    if (oa !== ob) return oa - ob
    const la = overdueState(a, today, nowMs, windowDays) === "none" ? 1 : 0
    const lb = overdueState(b, today, nowMs, windowDays) === "none" ? 1 : 0
    if (la !== lb) return la - lb
    if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1
    if (a.time !== b.time) return (a.time ?? "") < (b.time ?? "") ? -1 : 1
    const pa = PRIORITY[a.priority ?? "MEDIUM"] ?? 2
    const pb = PRIORITY[b.priority ?? "MEDIUM"] ?? 2
    if (pa !== pb) return pa - pb
    if (a.masked !== b.masked) return a.masked ? 1 : -1
    const ta = a.title ?? ""
    const tb = b.title ?? ""
    if (ta !== tb) return ta.localeCompare(tb, "id")
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  }
}

export type PersonRow = { userId: string; items: CalItem[] }

export type TreeNode = {
  unit: CalUnit
  /** Unique tasks in this unit and everything below it. */
  count: number
  /** Tasks placed exactly here (lens "division"). */
  items: CalItem[]
  /** People placed exactly here with their tasks (lens "person"), in Bagan box order. */
  people: PersonRow[]
  /** Tasks placed here without a person (no PIC → its project's division). Lens "person" shows them under the unit. */
  loose: CalItem[]
  children: TreeNode[]
}

export type DayTree = {
  /** The focus unit, with the tasks placed on it directly first and its sub-units after. */
  root: TreeNode | null
  /** Unique tasks shown. */
  total: number
  /** Distinct people with a task. */
  people: number
  /** PICs not in the Bagan, beside other PICs who are (lens "person" lists them last). */
  unplaced: PersonRow[]
}

/** BoD / One Above All, Manager, Staff, then people "di bawah" a leader of that card; A–Z within. */
export function personOrder(ix: CalIndex, unitId: string) {
  const tier = (id: string) => {
    const p = ix.person.get(id)
    if (!p) return 4
    if (p.reportsTo[unitId]) return 3
    return p.role === "ONE_ABOVE_ALL" || p.role === "BOD" ? 0 : p.role === "MANAGER" ? 1 : 2
  }
  const name = (id: string) => ix.person.get(id)?.name ?? ""
  return (a: string, b: string) => tier(a) - tier(b) || name(a).localeCompare(name(b), "id") || (a < b ? -1 : 1)
}

export function dayTree(items: CalItem[], ix: CalIndex, focusId: string, today: string, nowMs: number, windowDays: number): DayTree {
  const focus = ix.byId.get(focusId)
  if (!focus) return { root: null, total: 0, people: 0, unplaced: [] }
  const sub = ix.subtree([focusId])
  const at = new Map<string, { items: Map<string, CalItem>; people: Map<string, Map<string, CalItem>>; loose: Map<string, CalItem> }>()
  const slot = (unitId: string) => {
    let s = at.get(unitId)
    if (!s) at.set(unitId, (s = { items: new Map(), people: new Map(), loose: new Map() }))
    return s
  }
  const shown = new Set<string>()
  const who = new Set<string>()
  const unplaced = new Map<string, Map<string, CalItem>>()
  for (const i of items) {
    let inside = false
    for (const p of i.placements) {
      if (!sub.has(p.unitId)) continue
      inside = true
      const s = slot(p.unitId)
      s.items.set(i.key, i)
      if (p.userIds.length === 0) s.loose.set(i.key, i)
      for (const u of p.userIds) {
        const m = s.people.get(u) ?? new Map<string, CalItem>()
        m.set(i.key, i)
        s.people.set(u, m)
        who.add(u)
      }
    }
    if (!inside) continue
    shown.add(i.key)
    if (i.placedBy === "pic") {
      for (const u of i.unplacedIds) {
        const m = unplaced.get(u) ?? new Map<string, CalItem>()
        m.set(i.key, i)
        unplaced.set(u, m)
        who.add(u)
      }
    }
  }
  const cmp = compareInDay(today, nowMs, windowDays)
  const build = (u: CalUnit): TreeNode | null => {
    const s = at.get(u.id)
    const kids = (ix.children.get(u.id) ?? []).map(build).filter((n): n is TreeNode => n !== null)
    const keys = new Set<string>(s ? [...s.items.keys()] : [])
    const collect = (n: TreeNode) => { for (const i of n.items) keys.add(i.key); n.children.forEach(collect) }
    kids.forEach(collect)
    if (keys.size === 0) return null
    const order = personOrder(ix, u.id)
    return {
      unit: u,
      count: keys.size,
      items: s ? [...s.items.values()].sort(cmp) : [],
      people: s ? [...s.people.entries()].sort((a, b) => order(a[0], b[0])).map(([userId, m]) => ({ userId, items: [...m.values()].sort(cmp) })) : [],
      loose: s ? [...s.loose.values()].sort(cmp) : [],
      children: kids,
    }
  }
  const name = (id: string) => ix.person.get(id)?.name ?? ""
  return {
    root: build(focus),
    total: shown.size,
    people: who.size,
    unplaced: [...unplaced.entries()]
      .sort((a, b) => name(a[0]).localeCompare(name(b[0]), "id") || (a[0] < b[0] ? -1 : 1))
      .map(([userId, m]) => ({ userId, items: [...m.values()].sort(cmp) })),
  }
}

// ── Week "People" table ────────────────────────────────────────────────────────────────────────────

export type WeekRow =
  | { kind: "unit"; unit: CalUnit; depth: number; count: number }
  /** "Not in the chart yet": PICs outside the Bagan, beside PICs who are in it. */
  | { kind: "unplaced"; depth: number; count: number }
  | { kind: "person"; unitId: string | null; userId: string; depth: number; days: CalItem[][] }
  | { kind: "loose"; unitId: string; depth: number; days: CalItem[][] }

/**
 * Rows of the week table: unit headers in Bagan order (indented by depth under the focus), each with
 * its people (Bagan box order) and a row for tasks without a person; columns = Monday…Sunday.
 */
export function weekRows(items: CalItem[], ix: CalIndex, focusId: string, monday: string, today: string, nowMs: number, windowDays: number): WeekRow[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const week = items.filter((i) => days.includes(i.day))
  const tree = dayTree(week, ix, focusId, today, nowMs, windowDays)
  const split = (list: CalItem[]) => days.map((d) => list.filter((i) => i.day === d))
  const out: WeekRow[] = []
  const walk = (n: TreeNode, depth: number) => {
    out.push({ kind: "unit", unit: n.unit, depth, count: n.count })
    for (const p of n.people) out.push({ kind: "person", unitId: n.unit.id, userId: p.userId, depth: depth + 1, days: split(p.items) })
    if (n.loose.length) out.push({ kind: "loose", unitId: n.unit.id, depth: depth + 1, days: split(n.loose) })
    for (const k of n.children) walk(k, depth + 1)
  }
  if (tree.root) walk(tree.root, 0)
  if (tree.root && tree.unplaced.length) {
    out.push({ kind: "unplaced", depth: 0, count: tree.unplaced.length })
    for (const p of tree.unplaced) out.push({ kind: "person", unitId: null, userId: p.userId, depth: 1, days: split(p.items) })
  }
  return out
}

// ── Overdue rail ───────────────────────────────────────────────────────────────────────────────────

/** Overdue within the window, newest day first — from /overdue plus today's timed tasks whose time has passed. */
export function overdueRail(overdue: CalItem[], todays: CalItem[], today: string, nowMs: number, windowDays: number): CalItem[] {
  const seen = new Set<string>()
  const out: CalItem[] = []
  for (const i of [...todays, ...overdue]) {
    if (seen.has(i.key) || overdueState(i, today, nowMs, windowDays) !== "recent") continue
    seen.add(i.key)
    out.push(i)
  }
  const cmp = compareInDay(today, nowMs, windowDays)
  return out.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : cmp(a, b)))
}
