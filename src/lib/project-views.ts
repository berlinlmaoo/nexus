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
 * `config` is stored as JSON and read by the web (apps/web/src/lib/project-views.ts, which
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
 *   columnCalcs:   { [prop]: "count_all" | "count_values" | "count_empty" | "percent_empty" |
 *                  "percent_not_empty" | "sum" | "avg" | "median" | "min" | "max" | "range" }  (Table footer)
 * A prop is "title" | "section" | "status" | "priority" | "assignee" | "due" | "start" | "tags" |
 * "created" | "updated" | "subtasks" | "comments" | "cf:<customFieldId>".
 */

import type { PrismaClient } from "@/generated/prisma/client"
import { findProjectTemplate, pick } from "@/lib/project-templates"

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

/** Table footer calculations (Notion's "Calculate"). */
export const COLUMN_CALCS = ["count_all", "count_values", "count_empty", "percent_empty", "percent_not_empty", "sum", "avg", "median", "min", "max", "range"] as const

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
  if (isObj(raw.columnCalcs)) {
    const calcs: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.columnCalcs).slice(0, 80)) {
      const kind = ONE_OF(v, COLUMN_CALCS)
      if (prop(k) && kind) calcs[k] = kind
    }
    out.columnCalcs = calcs
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
export function builtinViewSeed(key: BuiltinViewKey | "board" | "list" | "table", tableColumns: unknown): { layout: ViewLayout; config: Record<string, unknown> } {
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
    default:
      return { layout: "board", config: {} }
    case "timeline":
      return { layout: "timeline", config: { groupBy: "section", startProp: "start", endProp: "due" } }
  }
}

type Db = Pick<PrismaClient, "projectView">

/** What seeding needs to know about a project. */
export type SeedProject = {
  id: string
  tableColumns: unknown
  templateId: string | null
  customFields: Array<{ id: string; name: string; type: string }>
  sectionNames: string[]
}

/** Is this one of the five migrated tabs (fixed layout, hidden through hiddenTabs, not deletable)? */
export function isBuiltinTab(builtin: string | null | undefined): builtin is BuiltinViewKey {
  return !!builtin && (BUILTIN_VIEW_KEYS as readonly string[]).includes(builtin)
}

/**
 * A project made from a template (lib/project-templates.ts) starts with its views set up the way the
 * template says: the Calendar plots the template's date field, and a template "My …" preset (Notion's
 * "My meetings") becomes a real shared view filtered on assignee = whoever looks ("__me__"). The field is
 * found by name in either language, since the project was built in one of them.
 */
function templateSeeds(project: SeedProject): { calendarDateProp?: string; mine?: { name: string; layout: ViewLayout; config: Record<string, unknown> } } {
  const tpl = findProjectTemplate(project.templateId)
  if (!tpl) return {}
  const out: ReturnType<typeof templateSeeds> = {}
  if (tpl.calendarBy && tpl.calendarBy !== "dueDate") {
    const f = tpl.fields.find((x) => `cf:${x.key}` === tpl.calendarBy)
    const def = f && project.customFields.find((d) => d.type === "DATE" && (d.name === f.name.en || d.name === f.name.id))
    if (def) out.calendarDateProp = `cf:${def.id}`
  }
  if (tpl.myView) {
    const usesId = tpl.sections.some((s) => s.name.id !== s.name.en && project.sectionNames.includes(s.name.id))
      || tpl.fields.some((f) => f.name.id !== f.name.en && project.customFields.some((d) => d.name === f.name.id))
    const usesEn = tpl.sections.some((s) => s.name.id !== s.name.en && project.sectionNames.includes(s.name.en))
    const lang = usesId || !usesEn ? "id" : "en"
    const base = builtinViewSeed(tpl.myView.tab, project.tableColumns)
    out.mine = {
      name: pick(tpl.myView.name, lang),
      layout: base.layout,
      config: { ...base.config, filter: { simple: [{ id: "mine", prop: "assignee", op: "any_of", value: ["__me__"] }], advanced: null } },
    }
  }
  return out
}

/**
 * Creates the project's missing built-in views. Safe to run concurrently (partial unique index on
 * projectId + builtin). The template's extra "My …" view (builtin "mine") is only made together with the
 * very first set, so deleting it later is final.
 */
export async function ensureBuiltinViews(db: Db, project: SeedProject, existingBuiltins: Set<string>) {
  const missing = BUILTIN_VIEW_KEYS.filter((k) => !existingBuiltins.has(k))
  if (missing.length === 0) return false
  const extras = templateSeeds(project)
  const data: Array<{ projectId: string; builtin: string; layout: string; position: number; config: object; name: string | null; ownerId: null }> = missing.map((key) => {
    const seed = builtinViewSeed(key, project.tableColumns)
    const config = key === "calendar" && extras.calendarDateProp ? { ...seed.config, dateProp: extras.calendarDateProp } : seed.config
    return { projectId: project.id, builtin: key, layout: seed.layout, position: BUILTIN_VIEW_KEYS.indexOf(key), config, name: null, ownerId: null }
  })
  if (existingBuiltins.size === 0 && extras.mine) {
    data.push({ projectId: project.id, builtin: "mine", layout: extras.mine.layout, position: BUILTIN_VIEW_KEYS.length, config: extras.mine.config, name: extras.mine.name, ownerId: null })
  }
  await db.projectView.createMany({ data, skipDuplicates: true })
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
