/**
 * Calendar (the master calendar that replaces Team Calendar, owner 5 Oct 2026) — the pure rules behind
 * every endpoint under /api/calendar/. No database and no imports, so the golden tests run this file
 * with plain node (core.test.mjs) and the iOS/Android ports can be checked against the same output.
 *
 * What the owner decided (plan "Rencana Kalender NEXUS", section 8):
 *   1. Everyone sees every task, except tasks of PRIVATE projects (Legal + Finance by default) for staff
 *      who are not in those projects: they get the row without title or id ("Tugas internal").
 *   3. Entries of the "… Master Calendar" projects stay TASKS — there is no event kind.
 *   5. A task sits under the Bagan cards of the people doing it (its PICs), not under its project:
 *      tasks and projects have no division, people do.
 * The Bagan grants nothing: the calendar only uses it to group.
 */

// ── Days (WIB) ────────────────────────────────────────────────────────────────────────────────────
// Task.dueDate is a `timestamp without time zone` holding UTC. A date picked without a time is stored
// at 00:00 UTC (07:00 WIB); 18 tasks were stored at 00:00 WIB (17:00 UTC the day before). Every day
// is a WIB day — a client never derives the day from the ISO string.

export const CALENDAR_TZ = "Asia/Jakarta"
const WIB_OFFSET_MS = 7 * 3_600_000
const DAY_MS = 86_400_000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (n: number) => String(n).padStart(2, "0")

/** The WIB calendar day ("YYYY-MM-DD") of an instant. */
export function wibDay(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10)
}

/** "HH:MM" in WIB, or null for a date without a time (stored at 00:00 UTC, or at 00:00 WIB). 23:59 keeps its time. */
export function wibTime(d: Date): string | null {
  const t = d.getTime()
  if (t % DAY_MS === 0) return null
  const w = new Date(t + WIB_OFFSET_MS)
  const hh = w.getUTCHours()
  const mm = w.getUTCMinutes()
  if (hh === 0 && mm === 0) return null
  return `${pad(hh)}:${pad(mm)}`
}

/** A real calendar day written "YYYY-MM-DD". */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== "string") return false
  const m = DAY_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toISOString().slice(0, 10) === s
}

/** The instant a WIB day starts (00:00 WIB = 17:00 UTC the day before). */
export function dayStartUtc(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - WIB_OFFSET_MS)
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Days from `a` to `b` (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay()
}

/** The Monday on or before `day`. */
export function mondayOf(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7))
}

/** The Sunday on or after `day`. */
export function sundayOf(day: string): string {
  return addDays(day, (7 - weekdayOf(day)) % 7)
}

/**
 * Overdue NOW: an open task whose day has passed, or — when it has a time — whose moment has passed.
 * A date-only task due today is not overdue until the WIB day ends (the dashboard used to count it from
 * 07:00 WIB).
 */
export function isOverdueAt(due: Date, done: boolean, now: Date): boolean {
  if (done) return false
  if (wibTime(due) === null) return wibDay(due) < wibDay(now)
  return due.getTime() < now.getTime()
}

// ── Settings (AppSetting "calendar") ────────────────────────────────────────────────────────────────

export type CalendarVisibility = "all" | "all_except_private" | "masked_foreign" | "projects"
export type CalendarAudience = "bod" | "managers" | "all"

export type CalendarSettings = {
  /** Who sees the new Calendar while it rolls out: bod → managers → all (decision 14). */
  audience: CalendarAudience
  /** Testers who see it regardless of `audience`. */
  audienceUserIds: string[]
  /** What staff see of projects they are not in (decision 1 = all_except_private). */
  visibility: CalendarVisibility
  /** Private on top of the name prefixes. */
  privateProjectIds: string[]
  /** Never private, even when the name starts with a private prefix (the Control Room toggle). */
  notPrivateProjectIds: string[]
  /** A project whose name starts with one of these (case-insensitive) is private — new Finance/Legal ones too. */
  privateNamePrefixes: string[]
  /** Overdue longer than this → "Terbengkalai" instead of the overdue rail (decision 6). */
  overdueWindowDays: number
  /** "Mendesak" = due within this many days counting today (2 = today and tomorrow). */
  urgentDays: number
}

export const CALENDAR_SETTINGS_DEFAULTS: CalendarSettings = {
  audience: "bod",
  audienceUserIds: [],
  visibility: "all_except_private",
  privateProjectIds: [],
  notPrivateProjectIds: [],
  privateNamePrefixes: ["finance", "legal"],
  overdueWindowDays: 14,
  urgentDays: 2,
}

const VISIBILITIES: readonly string[] = ["all", "all_except_private", "masked_foreign", "projects"]
const AUDIENCES: readonly string[] = ["bod", "managers", "all"]

function idList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  return Array.from(new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))).slice(0, 500)
}
function intIn(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null
}

/** A stored (or PATCHed) value made safe: every field that is missing or wrong takes the default. */
export function normalizeCalendarSettings(raw: unknown, base: CalendarSettings = CALENDAR_SETTINGS_DEFAULTS): CalendarSettings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const prefixes = Array.isArray(r.privateNamePrefixes)
    ? Array.from(new Set(r.privateNamePrefixes.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter((x) => x.length > 0 && x.length <= 40))).slice(0, 20)
    : null
  return {
    audience: typeof r.audience === "string" && AUDIENCES.includes(r.audience) ? (r.audience as CalendarAudience) : base.audience,
    audienceUserIds: idList(r.audienceUserIds) ?? base.audienceUserIds,
    visibility: typeof r.visibility === "string" && VISIBILITIES.includes(r.visibility) ? (r.visibility as CalendarVisibility) : base.visibility,
    privateProjectIds: idList(r.privateProjectIds) ?? base.privateProjectIds,
    notPrivateProjectIds: idList(r.notPrivateProjectIds) ?? base.notPrivateProjectIds,
    privateNamePrefixes: prefixes ?? base.privateNamePrefixes,
    overdueWindowDays: intIn(r.overdueWindowDays, 1, 90) ?? base.overdueWindowDays,
    urgentDays: intIn(r.urgentDays, 1, 7) ?? base.urgentDays,
  }
}

/** Why a project is private: listed by hand, by its name, or not at all. */
export function privacyOf(s: CalendarSettings, p: { id: string; name: string }): "list" | "prefix" | null {
  if (s.notPrivateProjectIds.includes(p.id)) return null
  if (s.privateProjectIds.includes(p.id)) return "list"
  const name = p.name.trim().toLowerCase()
  return s.privateNamePrefixes.some((x) => name.startsWith(x)) ? "prefix" : null
}

/** "Everything but private projects" with no private project defined would show everything: hide foreign titles instead. */
export function effectiveVisibility(s: CalendarSettings): CalendarVisibility {
  if (s.visibility === "all_except_private" && s.privateProjectIds.length === 0 && s.privateNamePrefixes.length === 0) return "masked_foreign"
  return s.visibility
}

/** Company role: ONE_ABOVE_ALL | BOD | MANAGER | STAFF, or null for a non-member. */
export function inAudience(s: CalendarSettings, v: { userId: string; orgRole: string | null; isAdmin: boolean }): boolean {
  if (v.isAdmin || s.audienceUserIds.includes(v.userId)) return true
  if (s.audience === "all") return true
  if (v.orgRole === "ONE_ABOVE_ALL" || v.orgRole === "BOD") return true
  return s.audience === "managers" && v.orgRole === "MANAGER"
}

// ── Structure (the Bagan, made safe for everyone) ───────────────────────────────────────────────────

export type OrgUnitRow = { id: string; name: string; kind: string; logoUrl: string | null; parentId: string | null; position: number; leadUserId: string | null }
/** Company members in the order GET /api/admin/org-chart lists them (name A–Z). `email` only labels a nameless person and is never sent. */
export type OrgPersonRow = { userId: string; name: string | null; email: string | null; avatar: string | null; role: string }
export type OrgLinkRow = { unitId: string; userId: string; title: string | null; reportsToUserId: string | null }

export type CalUnit = {
  id: string
  name: string
  kind: string
  parentId: string | null
  /** Bagan canvas order, top to bottom and left to right: sort by it everywhere. */
  rank: number
  /** Cards (not groups) above it: 0 = the top. */
  depth: number
  /** The card right under the top this unit belongs to (the top itself for the top). */
  sectionId: string
  color: string
  colorDark: string
  logoUrl: string | null
  leadUserId: string | null
}

export type CalPerson = {
  userId: string
  name: string | null
  avatar: string | null
  role: string
  unitIds: string[]
  /** Where their tasks go: the cards they sit in, minus a card when they also sit in a card below it. */
  homeUnitIds: string[]
  titles: Record<string, string>
  reportsTo: Record<string, string>
}

export type CalStructure = { units: CalUnit[]; people: CalPerson[] }

/**
 * Slots 1–9 (contrast ≥4.2:1 on #f8f9fb and ≥6:1 on #151b26). Nine so the eight cards of Framework
 * Agency can all differ from each other AND from Framework Agency itself. The top has its own.
 */
export const UNIT_PALETTE = ["#0B6FB8", "#B35A00", "#00805E", "#B03A86", "#8A6D00", "#5B4BD6", "#00838F", "#8D5B3B", "#4A7A1E"]
export const UNIT_PALETTE_DARK = ["#5AA9E6", "#FF9A4D", "#3CCB9E", "#E39BC4", "#E0B43A", "#A08BFF", "#4DD0D9", "#D2A27A", "#9BD86A"]
export const ROOT_COLOR = "#0f2742"
export const ROOT_COLOR_DARK = "#9fb6d6"

const isGroup = (u: { kind: string }) => u.kind === "GROUP"
const isSenior = (role: string) => role === "BOD" || role === "ONE_ABOVE_ALL"

/** Same order as the web Bagan (OrgChart.tsx byPos), with the id as the last tie-break. */
function byPos(a: OrgUnitRow, b: OrgUnitRow): number {
  return a.position - b.position || a.name.localeCompare(b.name, "id") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Every group next to the first one; the other cards keep their order around them (OrgChart.tsx). */
function groupsTogether<T extends { kind: string }>(list: T[]): T[] {
  const first = list.findIndex(isGroup)
  if (first < 0) return list
  return [...list.slice(0, first).filter((k) => !isGroup(k)), ...list.filter(isGroup), ...list.slice(first).filter((k) => !isGroup(k))]
}

/**
 * The Bagan as the calendar needs it. Unit order follows the web chart exactly (rowOf in
 * OrgChart.tsx): under a card, the sub-units led by one of its BoD/Managers first in the order of their
 * leaders, then the others with every group side by side; inside a group, the cards led from the card
 * above it first. A parent that does not exist makes a unit a top; a loop is broken where it is found.
 */
export function buildStructure(unitRows: OrgUnitRow[], personRows: OrgPersonRow[], linkRows: OrgLinkRow[]): CalStructure {
  const byId = new Map(unitRows.map((u) => [u.id, u]))
  const parentOf = (id: string): string | null => {
    const p = byId.get(id)?.parentId ?? null
    return p && byId.has(p) && p !== id ? p : null
  }
  const ancestors = (id: string): string[] => {
    const out: string[] = []
    const seen = new Set([id])
    for (let p = parentOf(id); p && !seen.has(p); p = parentOf(p)) {
      out.push(p)
      seen.add(p)
    }
    return out
  }
  const effParent = (id: string) => ancestors(id).find((p) => !isGroup(byId.get(p)!)) ?? null

  const children = new Map<string, OrgUnitRow[]>()
  for (const u of unitRows) {
    const p = parentOf(u.id)
    if (p) children.set(p, [...(children.get(p) ?? []), u])
  }
  for (const list of children.values()) list.sort(byPos)

  // People per card, A–Z like the web chart; BoD/One Above All then Managers lead it.
  const people = new Map(personRows.map((p) => [p.userId, p]))
  const label = (p: OrgPersonRow) => p.name ?? p.email ?? ""
  const links = linkRows.filter((l) => byId.has(l.unitId) && people.has(l.userId))
  const membersOf = new Map<string, OrgPersonRow[]>()
  for (const l of links) membersOf.set(l.unitId, [...(membersOf.get(l.unitId) ?? []), people.get(l.userId)!])
  for (const list of membersOf.values()) list.sort((a, b) => label(a).localeCompare(label(b), "id") || (a.userId < b.userId ? -1 : 1))
  const leaderOrder = (unitId: string): Map<string, number> => {
    const all = membersOf.get(unitId) ?? []
    const ordered = [...all.filter((p) => isSenior(p.role)), ...all.filter((p) => p.role === "MANAGER")]
    return new Map(ordered.map((p, i) => [p.userId, i]))
  }

  const rowOf = (u: OrgUnitRow): OrgUnitRow[] => {
    const kids = children.get(u.id) ?? []
    const owner = isGroup(u) ? effParent(u.id) : u.id
    const idx = owner ? leaderOrder(owner) : new Map<string, number>()
    const led = (k: OrgUnitRow) => !isGroup(k) && !!k.leadUserId && idx.has(k.leadUserId)
    const first = kids.filter(led).sort((a, b) => idx.get(a.leadUserId!)! - idx.get(b.leadUserId!)! || byPos(a, b))
    return [...first, ...groupsTogether(kids.filter((k) => !led(k)))]
  }

  const rank = new Map<string, number>()
  const visit = (u: OrgUnitRow) => {
    if (rank.has(u.id)) return
    rank.set(u.id, rank.size)
    for (const k of rowOf(u)) visit(k)
  }
  for (const r of unitRows.filter((u) => !parentOf(u.id)).sort(byPos)) visit(r)
  // Units on a loop have no top: start from them (in Bagan order) so they still get a place.
  for (const u of [...unitRows].sort(byPos)) visit(u)

  // Colours: the cards under one card, counted THROUGH its groups (FA: Strategist, PM, Event, Digital
  // Services, Production House, KOL Management, Multimedia, Business = 8 different colours), skipping
  // the colour of the card itself, so no two cards of one division share a colour and none shares its
  // division's. A group (a ribbon) takes the colour of its first card.
  const color = new Map<string, [string, string]>()
  const cardsUnder = (u: OrgUnitRow, seen = new Set<string>([u.id])): OrgUnitRow[] =>
    rowOf(u).flatMap((k) => (seen.has(k.id) ? [] : (seen.add(k.id), isGroup(k) ? cardsUnder(k, seen) : [k])))
  for (const u of [...unitRows].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)) {
    if (isGroup(u) && effParent(u.id)) continue
    const own = color.get(u.id)?.[0]
    const slots = UNIT_PALETTE.map((_, j) => j).filter((j) => UNIT_PALETTE[j] !== own)
    cardsUnder(u).forEach((k, i) => {
      const j = slots[i % slots.length]
      if (!color.has(k.id)) color.set(k.id, [UNIT_PALETTE[j], UNIT_PALETTE_DARK[j]])
    })
  }
  for (const g of unitRows.filter(isGroup)) {
    const first = cardsUnder(g)[0]
    if (first && color.has(first.id)) color.set(g.id, color.get(first.id)!)
  }

  const units: CalUnit[] = [...unitRows]
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    .map((u) => {
      const up = ancestors(u.id)
      const cards = [...up].reverse().concat(u.id).filter((id) => !isGroup(byId.get(id)!))
      const top = !parentOf(u.id)
      const [c, cd] = top ? [ROOT_COLOR, ROOT_COLOR_DARK] : (color.get(u.id) ?? [UNIT_PALETTE[0], UNIT_PALETTE_DARK[0]])
      return {
        id: u.id, name: u.name, kind: u.kind, parentId: parentOf(u.id),
        rank: rank.get(u.id)!,
        depth: up.filter((p) => !isGroup(byId.get(p)!)).length,
        sectionId: cards[1] ?? cards[0] ?? u.id,
        color: c, colorDark: cd,
        logoUrl: isGroup(u) ? null : u.logoUrl,
        leadUserId: isGroup(u) ? null : u.leadUserId,
      }
    })

  const unitsOf = new Map<string, string[]>()
  const titles = new Map<string, Record<string, string>>()
  const reports = new Map<string, Record<string, string>>()
  for (const l of links) {
    unitsOf.set(l.userId, [...(unitsOf.get(l.userId) ?? []), l.unitId])
    if (l.title) titles.set(l.userId, { ...(titles.get(l.userId) ?? {}), [l.unitId]: l.title })
    if (l.reportsToUserId) reports.set(l.userId, { ...(reports.get(l.userId) ?? {}), [l.unitId]: l.reportsToUserId })
  }
  const homeOf = (unitIds: string[]): string[] => {
    const cards = unitIds.filter((id) => !isGroup(byId.get(id)!))
    const mine = new Set(cards)
    return cards
      .filter((id) => !cards.some((other) => other !== id && ancestors(other).includes(id)))
      .filter((id, i, all) => mine.has(id) && all.indexOf(id) === i)
      .sort((a, b) => rank.get(a)! - rank.get(b)!)
  }

  return {
    units,
    people: personRows.map((p) => {
      const unitIds = unitsOf.get(p.userId) ?? []
      return {
        userId: p.userId, name: p.name, avatar: p.avatar, role: p.role,
        unitIds, homeUnitIds: homeOf(unitIds),
        titles: titles.get(p.userId) ?? {},
        reportsTo: reports.get(p.userId) ?? {},
      }
    }),
  }
}

/** A unit and every unit below it. */
export function subtreeOf(units: CalUnit[], roots: string[]): Set<string> {
  const kids = new Map<string, string[]>()
  for (const u of units) if (u.parentId) kids.set(u.parentId, [...(kids.get(u.parentId) ?? []), u.id])
  const out = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()!
    if (out.has(id)) continue
    out.add(id)
    stack.push(...(kids.get(id) ?? []))
  }
  return out
}

// ── Items ───────────────────────────────────────────────────────────────────────────────────────────

export type TaskRow = {
  id: string
  title: string
  status: string
  priority: string
  dueDate: Date
  creatorId: string
  /** The parent of a subtask, with what it takes to decide whether this viewer may see it. */
  parent: { id: string; title: string; creatorId: string; projects: { id: string; name: string }[]; assigneeIds: string[] } | null
  project: { id: string; name: string; color: string }
  /**
   * The home project has no status (Project.disableTaskStatus — a calendar-only project): its tasks
   * cannot be ticked done, so they are never open work and never overdue (as in people-reports).
   */
  noStatus: boolean
  /** Projects the task is linked into besides its home project (TaskProject). */
  linkedProjects: { id: string; name: string }[]
  /** In the order they were assigned. */
  assigneeIds: string[]
}

export type CalViewer = {
  userId: string
  /** System admin, One Above All, BoD or Manager: they already see every project in full. */
  full: boolean
  memberProjectIds: Set<string>
}

export type CalItem = {
  /** Stable for a masked row too, and not reversible (HMAC of the id). */
  key: string
  id: string | null
  masked: boolean
  title: string | null
  day: string
  time: string | null
  due: string
  status: string
  done: boolean
  /** A calendar-only project: no done/not done, never overdue. */
  noStatus: boolean
  priority: string | null
  project: { id: string; name: string; color: string } | null
  linkedProjectIds: string[]
  /** Null when there is none, or when this viewer may not see the parent (it sits in a private project). */
  parent: { id: string; title: string } | null
  assigneeIds: string[]
  placements: { unitId: string; userIds: string[] }[]
  unplacedIds: string[]
  canEdit: boolean
  /** Send as projectContextId on PATCH /api/tasks/:id — the project that lets this viewer edit (home, or a linked one). */
  editProjectId: string | null
}

export type ItemContext = {
  viewer: CalViewer
  settings: CalendarSettings
  /** userId → home units, in Bagan order. */
  homeUnitsOf: Map<string, string[]>
  unitRank: Map<string, number>
  maskKey: (taskId: string) => string
}

/** "full", "masked" (a row without title, project or id) or "hidden" (not sent, not counted). */
export function visibilityOf(row: TaskRow, ctx: ItemContext): "full" | "masked" | "hidden" {
  const { viewer, settings } = ctx
  if (viewer.full) return "full"
  if (row.creatorId === viewer.userId || row.assigneeIds.includes(viewer.userId)) return "full"
  const projects = [row.project, ...row.linkedProjects]
  const member = projects.some((p) => viewer.memberProjectIds.has(p.id))
  if (member) return "full"
  switch (effectiveVisibility(settings)) {
    case "all": return "full"
    case "all_except_private": return projects.some((p) => privacyOf(settings, p) !== null) ? "masked" : "full"
    case "masked_foreign": return "masked"
    case "projects": return "hidden"
  }
}

/** One task as the calendar sends it, or null when the viewer may not see it at all. */
export function buildItem(row: TaskRow, ctx: ItemContext): CalItem | null {
  const vis = visibilityOf(row, ctx)
  if (vis === "hidden") return null
  const masked = vis === "masked"
  const byUnit = new Map<string, string[]>()
  const unplaced: string[] = []
  for (const userId of row.assigneeIds) {
    const homes = ctx.homeUnitsOf.get(userId) ?? []
    if (homes.length === 0) unplaced.push(userId)
    for (const unitId of homes) byUnit.set(unitId, [...(byUnit.get(unitId) ?? []), userId])
  }
  const placements = [...byUnit.entries()]
    .sort((a, b) => (ctx.unitRank.get(a[0]) ?? 0) - (ctx.unitRank.get(b[0]) ?? 0))
    .map(([unitId, userIds]) => ({ unitId, userIds }))
  const done = row.status === "DONE"
  const parentVisible = !masked && row.parent !== null && visibilityOf({
    ...row,
    id: row.parent.id,
    creatorId: row.parent.creatorId,
    assigneeIds: row.parent.assigneeIds,
    project: { ...(row.parent.projects[0] ?? row.project), color: "" },
    linkedProjects: row.parent.projects.slice(1),
  }, ctx) === "full"
  const editProjectId = masked
    ? null
    : ctx.viewer.full || ctx.viewer.memberProjectIds.has(row.project.id)
      ? row.project.id
      : (row.linkedProjects.find((p) => ctx.viewer.memberProjectIds.has(p.id))?.id ?? null)
  return {
    key: masked ? ctx.maskKey(row.id) : row.id,
    id: masked ? null : row.id,
    masked,
    title: masked ? null : row.title,
    day: wibDay(row.dueDate),
    time: wibTime(row.dueDate),
    due: row.dueDate.toISOString(),
    status: row.status,
    done,
    noStatus: row.noStatus,
    priority: masked ? null : row.priority,
    project: masked ? null : { id: row.project.id, name: row.project.name, color: row.project.color },
    linkedProjectIds: masked ? [] : row.linkedProjects.map((p) => p.id),
    parent: parentVisible && row.parent ? { id: row.parent.id, title: row.parent.title } : null,
    assigneeIds: row.assigneeIds,
    placements,
    unplacedIds: unplaced,
    canEdit: editProjectId !== null,
    editProjectId,
  }
}

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 }

/** Day, then date-only before timed, then time, open before done, priority, title, key — the same everywhere. */
export function compareItems(a: CalItem, b: CalItem): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if ((a.time === null) !== (b.time === null)) return a.time === null ? -1 : 1
  if (a.time !== b.time) return (a.time ?? "") < (b.time ?? "") ? -1 : 1
  if (a.done !== b.done) return a.done ? 1 : -1
  const pa = PRIORITY_ORDER[a.priority ?? "MEDIUM"] ?? 2
  const pb = PRIORITY_ORDER[b.priority ?? "MEDIUM"] ?? 2
  if (pa !== pb) return pa - pb
  if (a.masked !== b.masked) return a.masked ? 1 : -1
  const ta = a.title ?? ""
  const tb = b.title ?? ""
  if (ta !== tb) return ta.localeCompare(tb, "id")
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

export function buildItems(rows: TaskRow[], ctx: ItemContext): CalItem[] {
  return rows.map((r) => buildItem(r, ctx)).filter((x): x is CalItem => x !== null).sort(compareItems)
}

// ── Glance (widgets and Apple Watch) ────────────────────────────────────────────────────────────────

export type GlanceScope = "me" | "division" | "all"

export type GlanceEntry = {
  /** Null when masked. */
  id: string | null
  /** Only on a masked row: its stable key. */
  k?: string
  /** Title, cut at 60 characters; null when masked ("Internal task" in the app's language). */
  t: string | null
  /** Null for a task without a due date ("Suatu hari"). */
  day: string | null
  time: string | null
  /** Project colour for "me"; for "division" the first card inside my division; for "all" the division (section) colour. */
  c: string
  p: string | null
  prio: string | null
  done: boolean
  m: boolean
  /** Only when true: a calendar-only project — draw it, never count it as open or overdue. */
  ns?: true
}

/**
 * The window a widget can draw without asking again: from the earlier of (today − overdue window) and
 * the Monday of the week holding the 1st, to the Sunday of the last week of next month.
 */
export function glanceWindow(today: string, overdueWindowDays: number): { from: string; to: string } {
  const first = `${today.slice(0, 8)}01`
  const back = addDays(today, -overdueWindowDays)
  const monday = mondayOf(first)
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7)
  const nextNext = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10)
  return { from: back < monday ? back : monday, to: sundayOf(addDays(nextNext, -1)) }
}

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)

export type GlanceColors = {
  unitColor: Map<string, string>
  /** unit id → its section's colour (the card under the top it belongs to). */
  sectionColor: Map<string, string>
  /** The viewer's division (home cards and below), for scope "division". */
  division: Set<string>
}

export function glanceEntry(item: CalItem, scope: GlanceScope, colors: GlanceColors, dated = true): GlanceEntry {
  const inMine = scope === "division" ? item.placements.find((p) => colors.division.has(p.unitId)) : undefined
  const unit = (inMine ?? item.placements[0])?.unitId
  const unitHex = unit ? (scope === "all" ? colors.sectionColor.get(unit) : colors.unitColor.get(unit)) : undefined
  return {
    id: item.id,
    ...(item.masked ? { k: item.key } : {}),
    t: item.title === null ? null : cut(item.title, 60),
    day: dated ? item.day : null,
    time: dated ? item.time : null,
    c: scope === "me" ? (item.project?.color ?? "#64748b") : (unitHex ?? "#64748b"),
    p: item.project?.name ?? null,
    prio: item.priority,
    done: item.done,
    m: item.masked,
    ...(item.noStatus ? { ns: true as const } : {}),
  }
}

/**
 * At most `cap` entries: done (and status-less) tasks on past days go first, then the ones furthest from today; the rest
 * keep their order.
 */
export function capGlance(entries: GlanceEntry[], today: string, cap: number): { entries: GlanceEntry[]; truncated: boolean } {
  if (entries.length <= cap) return { entries, truncated: false }
  let keep = entries.filter((e) => !((e.done || e.ns) && e.day !== null && e.day < today))
  if (keep.length > cap) {
    const dist = (e: GlanceEntry) => (e.day === null ? 0 : Math.abs(dayDiff(today, e.day)))
    const chosen = new Set([...keep].sort((a, b) => dist(a) - dist(b)).slice(0, cap))
    keep = keep.filter((e) => chosen.has(e))
  }
  return { entries: keep, truncated: true }
}

/** Does an item belong to a widget's scope? `division` = the viewer's home units and everything below them. */
export function inScope(item: CalItem, scope: GlanceScope, viewerId: string, divisionUnits: Set<string>): boolean {
  if (scope === "all") return true
  if (scope === "me") return item.assigneeIds.includes(viewerId)
  return item.placements.some((p) => divisionUnits.has(p.unitId))
}
