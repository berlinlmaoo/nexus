/**
 * Saved views per project (owner, 12 Oct 2026, Notion-style). Model: ProjectView (prisma/schema.prisma).
 *
 * A view is a named tab over the project's tasks: a layout plus its own filters, sort, grouping, visible
 * properties and card options. Shared views (ownerId null) are the project's; personal views belong to
 * one person and nobody else sees them.
 *
 * The five tabs every project had before (Board, List, Table, Calendar, Timeline) are SHARED views with
 * `builtin` set. They are created on first read (ensureBuiltinViews), keep their layout, cannot be
 * deleted, and are shown or hidden by Project.hiddenTabs exactly as the tabs were — released iOS / Android
 * apps only know hiddenTabs and keep working unchanged. Hide a built-in view = add its key to hiddenTabs.
 *
 * `config` is stored as JSON and read by the web (apps/nexus-lovable-ui/src/lib/project-views.ts, which
 * evaluates it). The server does not evaluate it; it only checks its SHAPE here so a client cannot store
 * junk or something huge. Unknown keys are dropped, so a newer client's extra keys need a server update.
 *
 * Shape (every key optional):
 *   filter:        { simple: Rule[], advanced: Group | null }      simple rules AND the advanced group
 *     Rule  = { id, prop, op, value? }      value: string | number | string[]
 *     Group = { id, mode: "and" | "or", rules: (Rule | Group)[] } at most two levels deep
 *   sort:          { prop, dir: "asc" | "desc" }[]                  first entry wins, then the next
 *   groupBy:       prop | null           subGroupBy: prop | null (board swimlanes, list/table nesting)
 *   hiddenGroups:  string[]              hideEmptyGroups: boolean
 *   groupCalc:     { kind: "count" | "done" | "percent_done" | "sum" | "avg", prop? }
 *   visibleProps:  prop[] | null         null = the layout's default set, in the default order
 *   cardSize:      "small" | "medium" | "large"      cardCover: "none" | "image" (gallery)
 *   colorBy:       prop | null           colorRules: { id, prop, value, color }[]
 *   dateProp / startProp / endProp: prop (calendar day; timeline bar start and end)
 *   showSubtasks:  boolean               wrap: boolean
 * A prop is "title" | "section" | "status" | "priority" | "assignee" | "due" | "start" | "tags" |
 * "created" | "updated" | "subtasks" | "comments" | "cf:<customFieldId>".
 */

import type { PrismaClient } from "@/generated/prisma/client"

export const VIEW_LAYOUTS = ["board", "list", "table", "calendar", "timeline", "gallery"] as const
export type ViewLayout = (typeof VIEW_LAYOUTS)[number]

/** The five tabs that became views, in their old tab-bar order. Same keys as Project.hiddenTabs. */
export const BUILTIN_VIEW_KEYS = ["board", "list", "table", "calendar", "timeline"] as const
export type BuiltinViewKey = (typeof BUILTIN_VIEW_KEYS)[number]

export const MAX_VIEWS_PER_PROJECT = 60
const MAX_CONFIG_BYTES = 32_000
const MAX_NAME = 80

const PROP_RE = /^(title|section|status|priority|assignee|due|start|tags|created|updated|subtasks|comments|cf:[A-Za-z0-9_-]{1,64})$/
const OP_RE = /^[a-z_]{1,24}$/
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

export class ViewConfigError extends Error {
  code = "INVALID_VIEW" as const
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}
function prop(v: unknown): string | null {
  return typeof v === "string" && PROP_RE.test(v) ? v : null
}
function str(v: unknown, max = 200): string | null {
  return typeof v === "string" ? v.slice(0, max) : null
}
function strList(v: unknown, maxItems = 100, maxLen = 200): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, maxItems).map((x) => x.slice(0, maxLen)) : []
}

function cleanValue(v: unknown): string | number | string[] | undefined {
  if (typeof v === "string") return v.slice(0, 200)
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (Array.isArray(v)) return strList(v)
  return undefined
}

function cleanRule(r: unknown): Record<string, unknown> | null {
  if (!isObj(r)) return null
  const p = prop(r.prop)
  const op = typeof r.op === "string" && OP_RE.test(r.op) ? r.op : null
  const id = typeof r.id === "string" && ID_RE.test(r.id) ? r.id : null
  if (!p || !op || !id) return null
  const out: Record<string, unknown> = { id, prop: p, op }
  const value = cleanValue(r.value)
  if (value !== undefined) out.value = value
  return out
}

function cleanGroup(g: unknown, depth: number): Record<string, unknown> | null {
  if (!isObj(g)) return null
  const id = typeof g.id === "string" && ID_RE.test(g.id) ? g.id : null
  if (!id) return null
  const mode = g.mode === "or" ? "or" : "and"
  const rules: Record<string, unknown>[] = []
  for (const r of Array.isArray(g.rules) ? g.rules.slice(0, 40) : []) {
    const cleaned = isObj(r) && Array.isArray(r.rules) ? (depth < 2 ? cleanGroup(r, depth + 1) : null) : cleanRule(r)
    if (cleaned) rules.push(cleaned)
  }
  return { id, mode, rules }
}

const ONE_OF = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined

/** The stored form of a client's config: known keys, bounded sizes. Throws ViewConfigError when too big. */
export function sanitizeViewConfig(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {}
  if (!isObj(raw)) throw new ViewConfigError("config must be an object")
  if (JSON.stringify(raw).length > MAX_CONFIG_BYTES) throw new ViewConfigError("config is too large")
  const out: Record<string, unknown> = {}

  if (isObj(raw.filter)) {
    const simple = (Array.isArray(raw.filter.simple) ? raw.filter.simple.slice(0, 40) : []).map(cleanRule).filter(Boolean)
    const advanced = raw.filter.advanced ? cleanGroup(raw.filter.advanced, 1) : null
    out.filter = { simple, advanced }
  }
  if (Array.isArray(raw.sort)) {
    out.sort = raw.sort
      .slice(0, 8)
      .map((s) => (isObj(s) && prop(s.prop) ? { prop: s.prop as string, dir: s.dir === "desc" ? "desc" : "asc" } : null))
      .filter(Boolean)
  }
  for (const key of ["groupBy", "subGroupBy", "colorBy"] as const) {
    if (key in raw) out[key] = raw[key] === null ? null : prop(raw[key])
  }
  for (const key of ["dateProp", "startProp", "endProp"] as const) {
    const p = prop(raw[key])
    if (p) out[key] = p
  }
  if ("hiddenGroups" in raw) out.hiddenGroups = strList(raw.hiddenGroups, 200)
  if ("collapsedGroups" in raw) out.collapsedGroups = strList(raw.collapsedGroups, 200)
  for (const key of ["hideEmptyGroups", "showSubtasks", "wrap"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key]
  }
  if (isObj(raw.groupCalc)) {
    const kind = ONE_OF(raw.groupCalc.kind, ["count", "done", "percent_done", "sum", "avg"] as const)
    if (kind) out.groupCalc = { kind, ...(prop(raw.groupCalc.prop) ? { prop: raw.groupCalc.prop } : {}) }
  }
  if ("visibleProps" in raw) {
    out.visibleProps = raw.visibleProps === null ? null : strList(raw.visibleProps, 80).filter((p) => PROP_RE.test(p))
  }
  const cardSize = ONE_OF(raw.cardSize, ["small", "medium", "large"] as const)
  if (cardSize) out.cardSize = cardSize
  const cardCover = ONE_OF(raw.cardCover, ["none", "image"] as const)
  if (cardCover) out.cardCover = cardCover
  if (Array.isArray(raw.colorRules)) {
    out.colorRules = raw.colorRules
      .slice(0, 30)
      .map((r) => {
        if (!isObj(r)) return null
        const id = typeof r.id === "string" && ID_RE.test(r.id) ? r.id : null
        const p = prop(r.prop)
        const value = str(r.value)
        const color = typeof r.color === "string" && /^[a-z]{2,16}$/.test(r.color) ? r.color : null
        return id && p && value !== null && color ? { id, prop: p, value, color } : null
      })
      .filter(Boolean)
  }
  return out
}

export function cleanViewName(raw: unknown): string | null {
  if (raw === null) return null
  if (typeof raw !== "string") return null
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME)
  return name || null
}

export function isViewLayout(v: unknown): v is ViewLayout {
  return typeof v === "string" && (VIEW_LAYOUTS as readonly string[]).includes(v)
}

/**
 * What the five built-in views start with: what the old tabs showed. The Table view takes the project's
 * shared column list (Project.tableColumns, the old per-project Table setting) as its visible properties.
 */
export function builtinViewSeed(key: BuiltinViewKey, tableColumns: unknown): { layout: ViewLayout; config: Record<string, unknown> } {
  switch (key) {
    case "board":
      return { layout: "board", config: { groupBy: "section", showSubtasks: true } }
    case "list":
      return { layout: "list", config: { groupBy: "section", showSubtasks: true } }
    case "table": {
      const cols = Array.isArray(tableColumns) ? tableColumns.filter((c): c is string => typeof c === "string") : []
      const map: Record<string, string> = { dueDate: "due" }
      const visible = cols.map((c) => map[c] ?? c).filter((c) => PROP_RE.test(c))
      return { layout: "table", config: { groupBy: "section", ...(visible.length ? { visibleProps: visible } : {}) } }
    }
    case "calendar":
      return { layout: "calendar", config: { dateProp: "due" } }
    case "timeline":
      return { layout: "timeline", config: { groupBy: "section", startProp: "start", endProp: "due" } }
  }
}

type Db = Pick<PrismaClient, "projectView">

/** Creates the project's missing built-in views. Safe to run concurrently (partial unique index). */
export async function ensureBuiltinViews(db: Db, projectId: string, tableColumns: unknown, existingBuiltins: Set<string>) {
  const missing = BUILTIN_VIEW_KEYS.filter((k) => !existingBuiltins.has(k))
  if (missing.length === 0) return false
  await db.projectView.createMany({
    data: missing.map((key) => {
      const seed = builtinViewSeed(key, tableColumns)
      return { projectId, builtin: key, layout: seed.layout, position: BUILTIN_VIEW_KEYS.indexOf(key), config: seed.config as object, name: null, ownerId: null }
    }),
    skipDuplicates: true,
  })
  return true
}

export type ProjectViewRow = {
  id: string
  name: string | null
  layout: string
  builtin: string | null
  position: number
  config: unknown
  ownerId: string | null
  createdById: string | null
  createdAt: Date
  updatedAt: Date
}

/** The API shape (GET/POST/PATCH). `shared` is the convenient form of ownerId === null. */
export function serializeView(v: ProjectViewRow) {
  return {
    id: v.id,
    name: v.name,
    layout: v.layout,
    builtin: v.builtin,
    position: v.position,
    shared: v.ownerId === null,
    ownerId: v.ownerId,
    createdById: v.createdById,
    config: isObj(v.config) ? v.config : {},
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }
}
