// Per-project spreadsheet: shared types, first-open seeding, and access resolution.
//
// This is NOT the Table view. ProjectTableView renders TASKS with custom-field columns; a sheet's
// rows are free-form and belong to nothing.
import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import type { ProjectRole } from "@/generated/prisma/client"
import {
  detectInput, isFormulaCell, isTypedCell, parseDateText, parseLocaleNumber, serialToIso,
  type FormulaCell, type TypedCell,
} from "@/lib/sheet-formula"

export const SHEET_COLUMN_TYPES = ["text", "number", "currency", "date", "select", "multiselect", "checkbox", "task", "link"] as const
export type SheetColumnType = (typeof SHEET_COLUMN_TYPES)[number]

/** Conditional formatting: the first matching rule wins, like a CSS cascade with one hit. */
export const RULE_OPS = ["gt", "lt", "gte", "lte", "eq", "neq", "contains", "empty", "notEmpty"] as const
export type RuleOp = (typeof RULE_OPS)[number]
export const RULE_STYLES = ["red", "amber", "green", "blue", "grey", "bold"] as const

/** Header tints. A fixed set, not free hex, so a sheet can't drift off the app's palette. */
export const COLUMN_COLORS = ["rose", "amber", "green", "blue", "violet", "slate"] as const
export type ColumnColor = (typeof COLUMN_COLORS)[number]
export type RuleStyle = (typeof RULE_STYLES)[number]
export type SheetRule = { op: RuleOp; value?: string; style: RuleStyle }

export type SheetColumn = {
  id: string
  name: string
  type: SheetColumnType
  width?: number
  options?: string[]
  /** Header tint. Undefined = the default grey header. */
  color?: ColumnColor
  /**
   * Per-choice chip colours, keyed by the choice itself.
   *
   * A separate map rather than turning `options` into objects: `options: string[]` is already used by
   * import, multi-select and every existing sheet, and changing its shape would mean migrating all of
   * them to add a colour nobody asked for yet.
   */
  optionColors?: Record<string, ColumnColor>
  /** Conditional formatting rules, evaluated in order. */
  rules?: SheetRule[]
}

const MAX_RULES = 8

function readOptionColors(raw: unknown): Record<string, ColumnColor> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const out: Record<string, ColumnColor> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (COLUMN_COLORS.includes(value as ColumnColor)) out[key.slice(0, 80)] = value as ColumnColor
  }
  return Object.keys(out).length ? out : undefined
}

function readRules(raw: unknown): SheetRule[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: SheetRule[] = []
  for (const r of raw.slice(0, MAX_RULES)) {
    if (!r || typeof r !== "object") continue
    const o = r as Record<string, unknown>
    if (!RULE_OPS.includes(o.op as RuleOp) || !RULE_STYLES.includes(o.style as RuleStyle)) continue
    out.push({
      op: o.op as RuleOp,
      style: o.style as RuleStyle,
      ...(typeof o.value === "string" ? { value: o.value.slice(0, 120) } : {}),
    })
  }
  return out.length ? out : undefined
}

export const MAX_COLUMNS = 50
export const MAX_ROWS_PER_WRITE = 500
export const MAX_CELLS_PER_WRITE = 5000
export const COLUMN_NAME_MAX = 80

/**
 * A brand-new sheet is a BLANK canvas, like Google Sheets: unnamed text columns that show only their
 * A/B/C letter until someone types a header. Seeding opinionated columns ("Nama", "Nominal", …) would
 * push every team into a structure we guessed for them.
 *
 * Names are intentionally empty — the UI falls back to the column letter.
 */
export const DEFAULT_COLUMN_COUNT = 10
export const DEFAULT_SHEET_COLUMNS: SheetColumn[] = Array.from(
  { length: DEFAULT_COLUMN_COUNT },
  (_, i) => ({ id: `c_${i}`, name: "", type: "text" as const, width: 140 }),
)
export const DEFAULT_ROW_COUNT = 50

/**
 * Give a project its default sheet so the tab is never empty.
 *
 * Idempotent and race-safe via an advisory lock, the same shape the P&L defaults used
 * (retired 11 Oct 2026) — two tabs opening the view at once can't create two sheets, and an existing sheet
 * is never touched. Called lazily on GET (which is what covers the ~70 projects that predate this
 * feature) and best-effort at project create.
 */
/**
 * Self-heal for the cell-history trigger.
 *
 * The trigger (`sheet_row_revisions`, see prisma/migrations/manual/2026-08-04-sheet-revisions.sql)
 * lives only in Postgres — Prisma has no concept of triggers, and this repo has no Prisma migration
 * history at all, so nothing in the deploy path would notice if it went missing.
 *
 * The danger isn't losing it, it's losing it QUIETLY: cell edits keep saving perfectly and history
 * just silently stops recording, which nobody discovers until the day they need it. So it's checked
 * once per process (i.e. right after every deploy, when the risk actually exists) and rebuilt if
 * absent. Steady-state cost after the first sheet open is zero. The nightly purge cron passes
 * `force` so a long-lived process still gets re-checked daily.
 *
 * Never throws. A broken audit trail must not stop anyone from opening their spreadsheet.
 */
/**
 * Self-heal for the two formatting columns (11 Oct 2026, prisma/sql/2026-10-11-sheet-formatting.sql).
 *
 * The repo has no migration runner, so a deploy can land before the SQL is applied; every sheet
 * query would then fail on a column Prisma expects. Adding them is additive and idempotent, so the
 * first sheet request of each process makes sure they exist. Awaited by every sheet entry point.
 */
let formattingColumns: Promise<void> | null = null
export function ensureSheetFormattingColumns(): Promise<void> {
  formattingColumns ??= (async () => {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ProjectSheet" ADD COLUMN IF NOT EXISTS "settings" JSONB NOT NULL DEFAULT '{}'`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "SheetRow" ADD COLUMN IF NOT EXISTS "styles" JSONB`)
    } catch (err) {
      formattingColumns = null
      console.error("[sheets] could not ensure formatting columns:", err)
    }
  })()
  return formattingColumns
}

// ── Per-cell formatting ─────────────────────────────────────────────────────────────────────────

/** Palette names for text and fill colours (legacy); hex colours ("#ffe599") are accepted too. */
export const STYLE_COLORS = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink", "slate", "black"] as const
export type StyleColor = (typeof STYLE_COLORS)[number]
export const STYLE_NUMBER_FORMATS = ["auto", "num", "idr", "pct", "date", "text", "sci", "acct", "fin", "cur", "cur0", "time", "dt", "dur", "custom"] as const
const HEX = /^#[0-9a-f]{6}$/i
const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v)
const colorOf = (v: unknown): string | undefined =>
  STYLE_COLORS.includes(v as StyleColor) ? (v as string) : isHex(v) ? (v as string).toLowerCase() : undefined
const BORDER_LINES = ["thin", "medium", "thick", "dotted", "dashed", "double"] as const
type BorderEdge = { s: (typeof BORDER_LINES)[number]; c?: string }
/** Font families the toolbar offers (anything else is dropped, so a cell can't carry CSS). */
const FONT_RE = /^[A-Za-z0-9 \-]{1,40}$/

/**
 * One cell's formatting. Short keys because it is stored per cell:
 *   b bold · i italic · s strikethrough · u underline · fc text colour · bg fill colour (name or hex)
 *   ha horizontal align l|c|r · va vertical align t|m|b · w wrap (legacy) · wr o|w|c overflow/wrap/clip
 *   fs font size px (legacy) · fp font size pt · ff font family · rt rotation (deg or "v")
 *   nf number format · dp decimals · pt custom pattern · bd border sides (legacy) · bx borders with
 *   style + colour per side · nt note text
 */
export type CellStyle = {
  b?: 1; i?: 1; s?: 1; u?: 1
  fc?: string; bg?: string
  ha?: "l" | "c" | "r"; va?: "t" | "m" | "b"
  w?: 1; wr?: "o" | "w" | "c"; fs?: number; fp?: number; ff?: string
  rt?: number | "v"
  nf?: (typeof STYLE_NUMBER_FORMATS)[number]; dp?: number; pt?: string
  bd?: string
  bx?: { t?: BorderEdge; b?: BorderEdge; l?: BorderEdge; r?: BorderEdge }
  nt?: string
}

/** Validate one incoming style; null/empty means "no formatting". Unknown keys are dropped. */
export function normalizeCellStyle(raw: unknown): CellStyle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const out: CellStyle = {}
  for (const k of ["b", "i", "s", "u", "w"] as const) if (o[k] === 1 || o[k] === true) out[k] = 1
  const fc = colorOf(o.fc); if (fc) out.fc = fc
  const bg = colorOf(o.bg); if (bg) out.bg = bg
  if (o.ha === "l" || o.ha === "c" || o.ha === "r") out.ha = o.ha
  if (o.va === "t" || o.va === "m" || o.va === "b") out.va = o.va
  if (o.wr === "o" || o.wr === "w" || o.wr === "c") out.wr = o.wr
  if (typeof o.fs === "number" && o.fs >= 6 && o.fs <= 96) out.fs = Math.round(o.fs)
  if (typeof o.fp === "number" && o.fp >= 6 && o.fp <= 72) out.fp = Math.round(o.fp)
  if (typeof o.ff === "string" && FONT_RE.test(o.ff)) out.ff = o.ff
  if (o.rt === "v") out.rt = "v"
  else if (typeof o.rt === "number" && o.rt >= -90 && o.rt <= 90 && o.rt !== 0) out.rt = Math.round(o.rt)
  if (STYLE_NUMBER_FORMATS.includes(o.nf as CellStyle["nf"] & string) && o.nf !== "auto") out.nf = o.nf as CellStyle["nf"]
  if (typeof o.dp === "number" && o.dp >= 0 && o.dp <= 10) out.dp = Math.round(o.dp)
  if (typeof o.pt === "string" && o.pt.trim()) out.pt = o.pt.slice(0, 200)
  if (typeof o.bd === "string") {
    const sides = [...new Set(o.bd.split(""))].filter((c) => "tblr".includes(c)).sort().join("")
    if (sides) out.bd = sides
  }
  if (o.bx && typeof o.bx === "object" && !Array.isArray(o.bx)) {
    const bx: NonNullable<CellStyle["bx"]> = {}
    for (const side of ["t", "b", "l", "r"] as const) {
      const e = (o.bx as Record<string, unknown>)[side] as Record<string, unknown> | undefined
      if (!e || typeof e !== "object" || !BORDER_LINES.includes(e.s as BorderEdge["s"])) continue
      bx[side] = { s: e.s as BorderEdge["s"], ...(isHex(e.c) ? { c: (e.c as string).toLowerCase() } : {}) }
    }
    if (Object.keys(bx).length) out.bx = bx
  }
  if (typeof o.nt === "string" && o.nt.trim()) out.nt = o.nt.slice(0, 5000)
  return Object.keys(out).length ? out : null
}

export function readStyles(raw: unknown): Record<string, CellStyle> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, CellStyle>
}

// ── Sheet-level settings ────────────────────────────────────────────────────────────────────────

export type SheetMerge = { r: string; c: string; rs: number; cs: number }

/**
 * Data validation (owner, 12 Oct 2026: "exactly like Google Sheets"). A rule applies to one or more
 * ranges, each stored in the same id-space form as formula ranges ("{colId!rowId}:{colId!rowId}",
 * "{colId!*}:{colId!*}" for a whole column), so inserting rows or columns never moves them and a
 * deleted corner shrinks the range like a formula's (see sheet-structure.ts).
 */
export const VALIDATION_KINDS = [
  "list", "listRange",
  "textContains", "textNotContains", "textIs", "email", "url",
  "dateIs", "dateBefore", "dateAfter", "dateBetween", "dateValid",
  "gt", "gte", "lt", "lte", "eq", "neq", "between", "notBetween",
  "checkbox", "formula",
] as const
export type ValidationKind = (typeof VALIDATION_KINDS)[number]
export type SheetValidation = {
  id: string
  ranges: string[]
  kind: ValidationKind
  /** Dropdown items, or the criteria value(s) (two for "between"). */
  values?: string[]
  /** Dropdown item -> chip colour. */
  colors?: Record<string, string>
  /** Dropdown (from a range): the source range, stored form. */
  source?: string
  /** Custom formula, stored form (relative to the first range's top-left cell). */
  formula?: string
  multiple?: boolean
  /** Reject the input instead of showing a warning. */
  strict?: boolean
  display?: "chip" | "arrow" | "plain"
  help?: string
  /** Checkbox with custom cell values. */
  checked?: string
  unchecked?: string
}
const MAX_VALIDATIONS = 200
const STORED_RANGE = /^\{\$?[^!}]+!\$?[^}]+\}:\{\$?[^!}]+!\$?[^}]+\}$/

export function readValidations(raw: unknown): SheetValidation[] {
  if (!Array.isArray(raw)) return []
  const out: SheetValidation[] = []
  for (const r of raw.slice(0, MAX_VALIDATIONS)) {
    if (!r || typeof r !== "object") continue
    const o = r as Record<string, unknown>
    if (!VALIDATION_KINDS.includes(o.kind as ValidationKind)) continue
    const ranges = Array.isArray(o.ranges) ? o.ranges.filter((x): x is string => typeof x === "string" && x.length < 300 && STORED_RANGE.test(x)).slice(0, 20) : []
    if (!ranges.length) continue
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined)
    const rule: SheetValidation = {
      id: typeof o.id === "string" && o.id ? o.id.slice(0, 40) : `v_${randomUUID().slice(0, 8)}`,
      ranges,
      kind: o.kind as ValidationKind,
    }
    if (Array.isArray(o.values)) rule.values = o.values.map((v) => String(v).slice(0, 200)).slice(0, 500)
    if (o.colors && typeof o.colors === "object" && !Array.isArray(o.colors)) {
      const colors: Record<string, string> = {}
      for (const [k, v] of Object.entries(o.colors as Record<string, unknown>)) { const c = colorOf(v); if (c) colors[k.slice(0, 200)] = c }
      if (Object.keys(colors).length) rule.colors = colors
    }
    const source = str(o.source, 300); if (source && STORED_RANGE.test(source)) rule.source = source
    const formula = str(o.formula, 2000); if (formula) rule.formula = formula
    if (o.multiple === true) rule.multiple = true
    if (o.strict === true) rule.strict = true
    if (o.display === "chip" || o.display === "arrow" || o.display === "plain") rule.display = o.display
    const help = str(o.help, 500); if (help) rule.help = help
    const checked = str(o.checked, 100); if (checked) rule.checked = checked
    const unchecked = str(o.unchecked, 100); if (unchecked) rule.unchecked = unchecked
    out.push(rule)
  }
  return out
}
// ── The rest of Google Sheets' sheet-level model (12 Oct 2026; client: lib/sheet-model.ts) ──────
// Every key below is narrowed field by field: settings arrive from the browser and are shown to
// everyone, so nothing is stored that the grid doesn't understand.

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null)
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length ? v.slice(0, max) : undefined)
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined
const hex = (v: unknown): string | undefined => (isHex(v) ? (v as string).toLowerCase() : undefined)
const range = (v: unknown): string | undefined => (typeof v === "string" && v.length < 300 && STORED_RANGE.test(v) ? v : undefined)
const ranges = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.map(range).filter((x): x is string => Boolean(x)).slice(0, max) : [])
const idOf = (v: unknown, prefix: string) => str(v, 40) ?? `${prefix}_${randomUUID().slice(0, 8)}`
const list = <T>(v: unknown, max: number, fn: (o: Obj) => T | null): T[] => {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  for (const x of v.slice(0, max)) { const o = obj(x); const r = o ? fn(o) : null; if (r) out.push(r) }
  return out
}
const strings = (v: unknown, max: number, len: number): string[] | undefined =>
  Array.isArray(v) ? v.map((x) => String(x).slice(0, len)).slice(0, max) : undefined

const COND_KINDS = ["empty", "notEmpty", "textContains", "textNotContains", "textStarts", "textEnds", "textIs",
  "dateIs", "dateBefore", "dateAfter", "gt", "gte", "lt", "lte", "eq", "neq", "between", "notBetween", "formula"] as const
type CondKind = (typeof COND_KINDS)[number]
const condKind = (v: unknown): CondKind | undefined => (COND_KINDS.includes(v as CondKind) ? (v as CondKind) : undefined)
const SCALE_TYPES = ["min", "max", "num", "pct", "pctile", "none"] as const

function condStyle(v: unknown) {
  const o = obj(v); if (!o) return undefined
  const out: Obj = {}
  for (const k of ["b", "i", "u", "s"]) if (o[k] === 1 || o[k] === true) out[k] = 1
  const fc = hex(o.fc); if (fc) out.fc = fc
  const bg = hex(o.bg); if (bg) out.bg = bg
  return Object.keys(out).length ? out : undefined
}
function scalePoint(v: unknown) {
  const o = obj(v); if (!o || !SCALE_TYPES.includes(o.type as (typeof SCALE_TYPES)[number])) return undefined
  const color = hex(o.color); if (!color) return undefined
  return { type: o.type, color, ...(str(o.value, 200) !== undefined ? { value: str(o.value, 200) } : {}) }
}
function filterCrit(v: unknown) {
  const o = obj(v); if (!o) return undefined
  const out: Obj = {}
  const hidden = strings(o.hidden, 2000, 500); if (hidden?.length) out.hidden = hidden
  const c = obj(o.cond)
  if (c && condKind(c.kind)) out.cond = { kind: c.kind, ...(strings(c.values, 2, 500) ? { values: strings(c.values, 2, 500) } : {}), ...(str(c.formula, 2000) ? { formula: str(c.formula, 2000) } : {}) }
  const fill = hex(o.fill); if (fill) out.fill = fill
  const text = hex(o.text); if (text) out.text = text
  return Object.keys(out).length ? out : undefined
}
function sortSpec(v: unknown) {
  const o = obj(v); const colId = str(o?.colId, 100)
  return o && colId && (o.dir === "asc" || o.dir === "desc") ? { colId, dir: o.dir } : undefined
}
function sheetFilter(o: Obj): Obj | null {
  const r = range(o.range); if (!r) return null
  const out: Obj = { range: r }
  const cr = obj(o.criteria)
  if (cr) {
    const criteria: Obj = {}
    for (const [k, v] of Object.entries(cr).slice(0, MAX_COLUMNS)) { const c = filterCrit(v); if (c) criteria[k.slice(0, 100)] = c }
    if (Object.keys(criteria).length) out.criteria = criteria
  }
  const sort = sortSpec(o.sort); if (sort) out.sort = sort
  return out
}
function anchor(v: unknown) {
  const o = obj(v); const r = str(o?.r, 100), c = str(o?.c, 100)
  if (!o || !r || !c) return undefined
  return { r, c, ...(num(o.dx, -5000, 5000) !== undefined ? { dx: Math.round(num(o.dx, -5000, 5000)!) } : {}), ...(num(o.dy, -5000, 50000) !== undefined ? { dy: Math.round(num(o.dy, -5000, 50000)!) } : {}) }
}
const CHART_TYPES = ["column", "columnStacked", "column100", "bar", "barStacked", "bar100", "line", "lineSmooth", "area", "areaStacked",
  "area100", "areaStepped", "pie", "donut", "scatter", "bubble", "combo", "histogram", "radar", "waterfall", "scorecard", "table"]
const TABLE_TYPES = ["text", "number", "pct", "currency", "date", "time", "dt", "dur", "checkbox", "dropdown", "none"]
const PIVOT_FNS = ["SUM", "COUNTA", "COUNT", "COUNTUNIQUE", "AVERAGE", "MAX", "MIN", "MEDIAN", "PRODUCT", "STDEV", "STDEVP", "VAR", "VARP"]
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]{0,99}$/

function chartSpec(o: Obj): Obj | null {
  if (!CHART_TYPES.includes(o.type as string)) return null
  const at = anchor(o.at); if (!at) return null
  const out: Obj = { id: idOf(o.id, "ch"), type: o.type, ranges: ranges(o.ranges, 10), at, w: Math.round(num(o.w, 80, 2400) ?? 600), h: Math.round(num(o.h, 60, 1600) ?? 371) }
  for (const k of ["title", "subtitle", "xTitle", "yTitle"]) { const v = str(o[k], 200); if (v) out[k] = v }
  for (const k of ["headers", "labels", "transpose", "dataLabels", "gridlines"]) if (typeof o[k] === "boolean") out[k] = o[k]
  if (["sum", "avg", "count", "min", "max"].includes(o.aggregate as string)) out.aggregate = o.aggregate
  if (["top", "bottom", "right", "left", "none"].includes(o.legend as string)) out.legend = o.legend
  const colors = Array.isArray(o.colors) ? o.colors.map(hex).filter(Boolean).slice(0, 30) : []
  if (colors.length) out.colors = colors
  const bg = hex(o.bg); if (bg) out.bg = bg
  for (const k of ["yMin", "yMax"]) { const v = num(o[k], -1e15, 1e15); if (v !== undefined) out[k] = v }
  for (const k of ["key", "baseline"]) { const v = range(o[k]); if (v) out[k] = v }
  return out
}
function pivotSpec(v: unknown): Obj | undefined {
  const o = obj(v); const source = str(o?.source, 40); const r = str(o?.range, 300)
  if (!o || !source || !r || !STORED_RANGE.test(r)) return undefined
  const group = (x: Obj) => { const colId = str(x.colId, 100); return colId ? { colId, ...(x.order === "desc" ? { order: "desc" } : {}), ...(x.totals === false ? { totals: false } : {}) } : null }
  return {
    source, range: r,
    rows: list(o.rows, 10, group), cols: list(o.cols, 10, group),
    values: list(o.values, 20, (x) => { const colId = str(x.colId, 100); return colId && PIVOT_FNS.includes(x.fn as string) ? { colId, fn: x.fn, ...(["row", "col", "total"].includes(x.showAs as string) ? { showAs: x.showAs } : {}) } : null }),
    filters: list(o.filters, 20, (x) => { const colId = str(x.colId, 100); return colId ? { colId, ...(strings(x.hidden, 2000, 500)?.length ? { hidden: strings(x.hidden, 2000, 500) } : {}) } : null }),
  }
}

export type SheetSettings = {
  frozenRows?: number
  frozenCols?: number
  tabColor?: string
  hiddenRows?: string[]
  hiddenCols?: string[]
  merges?: SheetMerge[]
  validations?: SheetValidation[]
  condFormats?: Obj[]
  bandings?: Obj[]
  filter?: Obj
  filterViews?: Obj[]
  slicers?: Obj[]
  namedRanges?: { id: string; name: string; range: string }[]
  protections?: Protection[]
  rowGroups?: Obj[]
  colGroups?: Obj[]
  tables?: Obj[]
  charts?: Obj[]
  pivot?: Obj
  theme?: Obj
  locale?: "id-ID" | "en-US"
  timeZone?: string
  recalc?: "change" | "minute" | "hour"
  iterative?: { on: boolean; max: number; threshold: number }
  versions?: { id: string; name: string; at: string }[]
  hidden?: true
  noGrid?: true
}
export type Protection = { id: string; range?: string; sheet?: true; except?: string[]; desc?: string; mode: "warn" | "restrict"; editors?: string[]; by?: string }

const MAX_FROZEN_ROWS = 20
const MAX_FROZEN_COLS = 10

/** Narrow stored/incoming settings; anything malformed is dropped rather than trusted. */
export function readSheetSettings(raw: unknown): SheetSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: SheetSettings = {}
  const int = (v: unknown, max: number) => (typeof v === "number" && v >= 0 ? Math.min(max, Math.round(v)) : undefined)
  const fr = int(o.frozenRows, MAX_FROZEN_ROWS); if (fr) out.frozenRows = fr
  const fc = int(o.frozenCols, MAX_FROZEN_COLS); if (fc) out.frozenCols = fc
  if (COLUMN_COLORS.includes(o.tabColor as ColumnColor)) out.tabColor = o.tabColor as ColumnColor
  else if (isHex(o.tabColor)) out.tabColor = (o.tabColor as string).toLowerCase()
  const ids = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length < 100))].slice(0, max) : [])
  const hr = ids(o.hiddenRows, 2000); if (hr.length) out.hiddenRows = hr
  const hc = ids(o.hiddenCols, MAX_COLUMNS); if (hc.length) out.hiddenCols = hc
  if (Array.isArray(o.merges)) {
    const merges: SheetMerge[] = []
    for (const m of o.merges.slice(0, 500)) {
      if (!m || typeof m !== "object") continue
      const x = m as Record<string, unknown>
      const rs = int(x.rs, 500) ?? 1, cs = int(x.cs, MAX_COLUMNS) ?? 1
      if (typeof x.r !== "string" || typeof x.c !== "string" || rs * cs < 2) continue
      merges.push({ r: x.r, c: x.c, rs: Math.max(1, rs), cs: Math.max(1, cs) })
    }
    if (merges.length) out.merges = merges
  }
  const validations = readValidations(o.validations)
  if (validations.length) out.validations = validations

  const condFormats = list(o.condFormats, 200, (x) => {
    const rs = ranges(x.ranges); if (!rs.length) return null
    if (x.type === "scale") {
      const sc = obj(x.scale); const min = scalePoint(sc?.min), max = scalePoint(sc?.max)
      if (!min || !max) return null
      const mid = scalePoint(sc?.mid)
      return { id: idOf(x.id, "cf"), ranges: rs, type: "scale", scale: { min, max, ...(mid ? { mid } : {}) } }
    }
    const cond = condKind(x.cond); if (!cond) return null
    return {
      id: idOf(x.id, "cf"), ranges: rs, type: "single", cond,
      ...(strings(x.values, 2, 500) ? { values: strings(x.values, 2, 500) } : {}),
      ...(str(x.formula, 2000) ? { formula: str(x.formula, 2000) } : {}),
      ...(condStyle(x.style) ? { style: condStyle(x.style) } : {}),
    }
  })
  if (condFormats.length) out.condFormats = condFormats
  const bandings = list(o.bandings, 100, (x) => {
    const r = range(x.range), c1 = hex(x.c1), c2 = hex(x.c2)
    if (!r || !c1 || !c2) return null
    return { id: idOf(x.id, "bd"), range: r, c1, c2, ...(hex(x.header) ? { header: hex(x.header) } : {}), ...(hex(x.footer) ? { footer: hex(x.footer) } : {}) }
  })
  if (bandings.length) out.bandings = bandings
  const filter = obj(o.filter) ? sheetFilter(obj(o.filter)!) : null
  if (filter) out.filter = filter
  const views = list(o.filterViews, 50, (x) => { const f = sheetFilter(x); return f ? { ...f, id: idOf(x.id, "fv"), name: str(x.name, 100) ?? "Filter 1" } : null })
  if (views.length) out.filterViews = views
  const slicers = list(o.slicers, 50, (x) => {
    const r = range(x.range), colId = str(x.colId, 100), at = anchor(x.at)
    if (!r || !colId || !at) return null
    return { id: idOf(x.id, "sl"), range: r, colId, at, ...(num(x.w, 80, 800) ? { w: Math.round(num(x.w, 80, 800)!) } : {}), ...(str(x.title, 100) ? { title: str(x.title, 100) } : {}), ...(filterCrit(x.crit) ? { crit: filterCrit(x.crit) } : {}), ...(hex(x.bg) ? { bg: hex(x.bg) } : {}) }
  })
  if (slicers.length) out.slicers = slicers
  const seenNames = new Set<string>()
  const named = list(o.namedRanges, 200, (x) => {
    const name = str(x.name, 100), r = range(x.range)
    if (!name || !r || !NAME_RE.test(name) || /^[A-Za-z]{1,3}\d+$/.test(name) || /^(TRUE|FALSE)$/i.test(name) || seenNames.has(name.toUpperCase())) return null
    seenNames.add(name.toUpperCase())
    return { id: idOf(x.id, "nr"), name, range: r }
  })
  if (named.length) out.namedRanges = named
  const protections = list(o.protections, 100, (x): Protection | null => {
    const r = range(x.range)
    if (!r && x.sheet !== true) return null
    return {
      id: idOf(x.id, "pr"), mode: x.mode === "restrict" ? "restrict" : "warn",
      ...(r ? { range: r } : { sheet: true as const }),
      ...(ranges(x.except, 20).length ? { except: ranges(x.except, 20) } : {}),
      ...(str(x.desc, 200) ? { desc: str(x.desc, 200) } : {}),
      ...(Array.isArray(x.editors) ? { editors: x.editors.filter((e): e is string => typeof e === "string").map((e) => e.slice(0, 40)).slice(0, 200) } : {}),
      ...(str(x.by, 40) ? { by: str(x.by, 40) } : {}),
    }
  })
  if (protections.length) out.protections = protections
  for (const key of ["rowGroups", "colGroups"] as const) {
    const groups = list(o[key], 200, (x) => { const from = str(x.from, 100), to = str(x.to, 100); return from && to ? { id: idOf(x.id, "gr"), from, to, ...(x.collapsed === true ? { collapsed: true } : {}) } : null })
    if (groups.length) out[key] = groups
  }
  const tableNames = new Set<string>()
  const tables = list(o.tables, 50, (x) => {
    const r = range(x.range), name = str(x.name, 100)
    if (!r || !name || tableNames.has(name.toUpperCase())) return null
    tableNames.add(name.toUpperCase())
    const types: Obj = {}
    for (const [k, v] of Object.entries(obj(x.types) ?? {}).slice(0, MAX_COLUMNS)) if (TABLE_TYPES.includes(v as string)) types[k.slice(0, 100)] = v
    return { id: idOf(x.id, "tb"), name, range: r, ...(hex(x.header) ? { header: hex(x.header) } : {}), ...(x.banded === false ? { banded: false } : {}), ...(x.footer === true ? { footer: true } : {}), ...(Object.keys(types).length ? { types } : {}) }
  })
  if (tables.length) out.tables = tables
  const charts = list(o.charts, 30, chartSpec)
  if (charts.length) out.charts = charts
  const pivot = pivotSpec(o.pivot); if (pivot) out.pivot = pivot
  const th = obj(o.theme)
  if (th && str(th.name, 60)) {
    const accents = Array.isArray(th.accents) ? th.accents.map(hex).filter((x): x is string => Boolean(x)).slice(0, 6) : []
    out.theme = { name: str(th.name, 60), accents, ...(typeof th.font === "string" && FONT_RE.test(th.font) ? { font: th.font } : {}), ...(hex(th.text) ? { text: hex(th.text) } : {}), ...(hex(th.link) ? { link: hex(th.link) } : {}) }
  }
  if (o.locale === "id-ID" || o.locale === "en-US") out.locale = o.locale
  const tz = str(o.timeZone, 60); if (tz && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) out.timeZone = tz
  if (o.recalc === "change" || o.recalc === "minute" || o.recalc === "hour") out.recalc = o.recalc
  const it = obj(o.iterative)
  if (it) out.iterative = { on: it.on === true, max: Math.round(num(it.max, 1, 10000) ?? 50), threshold: num(it.threshold, 0, 1e6) ?? 0.05 }
  const versions = list(o.versions, 200, (x) => { const name = str(x.name, 100), at = str(x.at, 40); return name && at && !Number.isNaN(Date.parse(at)) ? { id: idOf(x.id, "vr"), name, at } : null })
  if (versions.length) out.versions = versions
  if (o.hidden === true) out.hidden = true
  if (o.noGrid === true) out.noGrid = true
  return out
}

// ── Protected ranges: server-side enforcement ───────────────────────────────────────────────────

/** May this user edit through `p`? The creator, the listed editors and project leads always may. */
async function mayEditProtected(userId: string, projectId: string, p: Protection): Promise<boolean> {
  if (p.mode !== "restrict") return true
  if (p.by === userId || p.editors?.includes(userId)) return true
  const { allowed } = await checkProjectAccess(userId, projectId, ["LEAD"])
  return allowed
}

type ProtSheet = { id: string; projectId: string; columns: SheetColumn[]; settings: SheetSettings }

/** The restricting protections this user is NOT allowed through, or [] (no query when there are none). */
async function lockedFor(userId: string, sheet: ProtSheet): Promise<Protection[]> {
  const restrict = (sheet.settings.protections ?? []).filter((p) => p.mode === "restrict")
  const out: Protection[] = []
  for (const p of restrict) if (!(await mayEditProtected(userId, sheet.projectId, p))) out.push(p)
  return out
}

const RANGE_PARTS = /^\{\$?([^!}]+)!\$?([^}]+)\}:\{\$?([^!}]+)!\$?([^}]+)\}$/
function rectOfRange(stored: string, colIdx: Map<string, number>, rowIdx: Map<string, number>, rowCount: number) {
  const m = RANGE_PARTS.exec(stored)
  if (!m) return null
  const c1 = colIdx.get(m[1]), c2 = colIdx.get(m[3])
  if (c1 === undefined || c2 === undefined) return null
  const r1 = m[2] === "*" ? 0 : rowIdx.get(m[2]), r2 = m[4] === "*" ? rowCount - 1 : rowIdx.get(m[4])
  if (r1 === undefined || r2 === undefined) return null
  return { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) }
}

/**
 * Refuse a write that touches a protected range the user may not edit. Returns the error text, or
 * null when the write is allowed. Rows are resolved by their CURRENT order (one id-only query, and
 * only when the sheet has a restricting protection this user isn't exempt from).
 */
export async function protectedCellsBlock(userId: string, sheet: ProtSheet, cells: { rowId: string; colId: string }[]): Promise<string | null> {
  if (!cells.length) return null
  const locked = await lockedFor(userId, sheet)
  if (!locked.length) return null
  const order = await prisma.sheetRow.findMany({ where: { sheetId: sheet.id }, orderBy: { position: "asc" }, select: { id: true } })
  const rowIdx = new Map(order.map((r, i) => [r.id, i]))
  const colIdx = new Map(sheet.columns.map((c, i) => [c.id, i]))
  const inside = (stored: string, r: number, c: number) => {
    const rc = rectOfRange(stored, colIdx, rowIdx, order.length)
    return Boolean(rc && r >= rc.top && r <= rc.bottom && c >= rc.left && c <= rc.right)
  }
  for (const { rowId, colId } of cells) {
    const r = rowIdx.get(rowId), c = colIdx.get(colId)
    if (r === undefined || c === undefined) continue
    for (const p of locked) {
      const hit = p.sheet ? !(p.except ?? []).some((x) => inside(x, r, c)) : p.range ? inside(p.range, r, c) : false
      if (hit) return `Bagian ini dilindungi${p.desc ? ` (${p.desc})` : ""}. Minta pemiliknya kalau perlu mengubah.`
    }
  }
  return null
}

/** Deleting or reordering rows is refused when any of them holds a protected cell. */
export async function protectedRowsBlock(userId: string, sheet: ProtSheet, rowIds: string[]): Promise<string | null> {
  if (!rowIds.length || !(sheet.settings.protections ?? []).some((p) => p.mode === "restrict")) return null
  return protectedCellsBlock(userId, sheet, rowIds.flatMap((rowId) => sheet.columns.map((c) => ({ rowId, colId: c.id }))))
}

/**
 * A settings PATCH may not remove or loosen a restricting protection unless the user may edit
 * through it (creator, listed editor, lead) — otherwise "protect" would be one request away from off.
 */
export async function protectionChangeBlock(userId: string, sheet: ProtSheet, next: SheetSettings): Promise<string | null> {
  const before = (sheet.settings.protections ?? []).filter((p) => p.mode === "restrict")
  for (const p of before) {
    const after = (next.protections ?? []).find((x) => x.id === p.id)
    const same = after && JSON.stringify(after) === JSON.stringify(p)
    if (!same && !(await mayEditProtected(userId, sheet.projectId, p))) return "Cuma pembuat proteksi, editor yang dipilih, atau lead yang boleh mengubah proteksi ini."
  }
  return null
}

let revisionTriggerChecked = false
export async function ensureRevisionTrigger(force = false): Promise<void> {
  if (revisionTriggerChecked && !force) return
  revisionTriggerChecked = true
  try {
    const found = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relname = 'SheetRow' AND t.tgname = 'sheet_row_revisions'
    `
    if (Number(found[0]?.n ?? 0) > 0) return

    console.error("[sheets] revision trigger MISSING — rebuilding it. Cell history was not being recorded.")
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION sheet_row_log_revisions() RETURNS trigger AS $fn$
      DECLARE k text;
      BEGIN
        IF OLD."cells" IS NOT DISTINCT FROM NEW."cells" THEN RETURN NULL; END IF;
        FOR k IN SELECT key FROM jsonb_each(COALESCE(OLD."cells", '{}'::jsonb) || COALESCE(NEW."cells", '{}'::jsonb))
        LOOP
          IF (OLD."cells" -> k) IS DISTINCT FROM (NEW."cells" -> k) THEN
            INSERT INTO "SheetCellRevision" ("sheetId","rowId","columnId","oldValue","newValue","authorId")
            VALUES (NEW."sheetId", NEW."id", k, OLD."cells" -> k, NEW."cells" -> k, NEW."updatedById");
          END IF;
        END LOOP;
        RETURN NULL;
      END;
      $fn$ LANGUAGE plpgsql;
    `)
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sheet_row_revisions ON "SheetRow"`)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER sheet_row_revisions
        AFTER UPDATE ON "SheetRow"
        FOR EACH ROW
        WHEN (OLD."cells" IS DISTINCT FROM NEW."cells")
        EXECUTE FUNCTION sheet_row_log_revisions();
    `)
    console.error("[sheets] revision trigger rebuilt.")
  } catch (err) {
    // Let the next process try again rather than staying stuck on a transient failure.
    revisionTriggerChecked = false
    console.error("[sheets] revision trigger check failed:", err)
  }
}

export async function ensureProjectSheet(projectId: string, userId?: string | null): Promise<string> {
  // Deliberately not awaited inside the transaction below — it must never hold the advisory lock.
  void ensureRevisionTrigger()
  await ensureSheetFormattingColumns()
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sheetseed|${projectId}`})::int8)`
    const existing = await tx.projectSheet.findFirst({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true },
    })
    if (existing) return existing.id

    const sheet = await tx.projectSheet.create({
      data: {
        projectId,
        name: "Sheet 1",
        position: 0,
        columns: DEFAULT_SHEET_COLUMNS as unknown as object,
        createdById: userId ?? null,
      },
      select: { id: true },
    })
    await tx.sheetRow.createMany({
      data: Array.from({ length: DEFAULT_ROW_COUNT }, (_, i) => ({ sheetId: sheet.id, position: i })),
    })
    return sheet.id
  })
}

type AccessOk = { allowed: true; sheet: { id: string; projectId: string; name: string; columns: SheetColumn[]; settings: SheetSettings } }
type AccessNo = { allowed: false; status: 403 | 404; error: string }

/**
 * Resolve a sheet AND the caller's rights on its project in one step.
 *
 * Every /api/sheets/[sheetId]/* route must go through this. A sheetId is an opaque id with no
 * project in it, so checking only "is the caller logged in" would let someone patch a sheet in a
 * project they have no access to at all.
 */
export async function resolveSheetAccess(
  userId: string,
  sheetId: string,
  roles: ProjectRole[],
): Promise<AccessOk | AccessNo> {
  await ensureSheetFormattingColumns()
  const sheet = await prisma.projectSheet.findUnique({
    where: { id: sheetId },
    select: { id: true, projectId: true, name: true, columns: true, settings: true },
  })
  if (!sheet) return { allowed: false, status: 404, error: "Sheet-nya nggak ketemu." }
  const { allowed } = await checkProjectAccess(userId, sheet.projectId, roles)
  if (!allowed) return { allowed: false, status: 403, error: "Kamu nggak punya akses ke sheet ini." }
  return { allowed: true, sheet: { ...sheet, columns: readColumns(sheet.columns), settings: readSheetSettings(sheet.settings) } }
}

/** Columns come back from Prisma as `Json`; narrow + drop anything malformed. */
export function readColumns(raw: unknown): SheetColumn[] {
  if (!Array.isArray(raw)) return []
  const out: SheetColumn[] = []
  for (const c of raw) {
    if (!c || typeof c !== "object") continue
    const o = c as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id : ""
    const name = typeof o.name === "string" ? o.name : ""
    const type = SHEET_COLUMN_TYPES.includes(o.type as SheetColumnType) ? (o.type as SheetColumnType) : "text"
    if (!id) continue
    out.push({
      id,
      name: name.slice(0, COLUMN_NAME_MAX),
      type,
      ...(typeof o.width === "number" ? { width: o.width } : {}),
      ...(Array.isArray(o.options) ? { options: o.options.map(String).slice(0, 100) } : {}),
      // Must mirror normalizeColumns field-for-field. Anything missing here is written to the DB and
      // then silently dropped on the way back out — which is exactly how `color` went missing.
      ...(COLUMN_COLORS.includes(o.color as ColumnColor) ? { color: o.color as ColumnColor } : {}),
      ...(readOptionColors(o.optionColors) ? { optionColors: readOptionColors(o.optionColors) } : {}),
      ...(readRules(o.rules) ? { rules: readRules(o.rules) } : {}),
    })
  }
  return out
}

/**
 * Validate an incoming column array for a structure PATCH.
 *
 * Columns arriving without an id are new — the SERVER mints it, never the client, because that id
 * becomes a permanent key inside every row's `cells`.
 */
export function normalizeColumns(raw: unknown, existing: SheetColumn[]): { columns: SheetColumn[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "columns harus berupa array." }
  if (raw.length > MAX_COLUMNS) return { error: `Maksimal ${MAX_COLUMNS} kolom.` }

  const seen = new Set<string>()
  const out: SheetColumn[] = []
  for (const c of raw) {
    if (!c || typeof c !== "object") return { error: "Ada kolom yang bentuknya nggak valid." }
    const o = c as Record<string, unknown>
    // An empty name is allowed on purpose: a blank sheet's columns are just A, B, C… until someone
    // names them. The UI renders the column letter whenever the name is blank.
    const name = String(o.name ?? "").trim()
    const type = SHEET_COLUMN_TYPES.includes(o.type as SheetColumnType) ? (o.type as SheetColumnType) : "text"
    const id = typeof o.id === "string" && o.id ? o.id : `c_${randomUUID().slice(0, 12)}`
    if (seen.has(id)) return { error: "Ada id kolom yang dobel." }
    seen.add(id)
    out.push({
      id,
      name: name.slice(0, COLUMN_NAME_MAX),
      type,
      ...(typeof o.width === "number" && o.width > 0 ? { width: Math.min(600, Math.round(o.width)) } : {}),
      // Blank/duplicate choices are dropped here rather than in the UI: a dropdown with two identical
      // entries is a data problem, not a rendering one.
      ...(Array.isArray(o.options)
        ? { options: [...new Set(o.options.map((x) => String(x).trim()).filter(Boolean))].map((x) => x.slice(0, 80)).slice(0, 100) }
        : {}),
      ...(COLUMN_COLORS.includes(o.color as ColumnColor) ? { color: o.color as ColumnColor } : {}),
      ...(readOptionColors(o.optionColors) ? { optionColors: readOptionColors(o.optionColors) } : {}),
      ...(readRules(o.rules) ? { rules: readRules(o.rules) } : {}),
    })
  }

  // Dropping a column also has to wipe its values from every row, so it goes through the explicit
  // DELETE route. Silently accepting a shorter array here would orphan data instead.
  const missing = existing.filter((c) => !seen.has(c.id))
  if (missing.length) {
    return { error: `Kolom "${missing[0].name}" nggak bisa dihapus dari sini — pakai tombol hapus kolom.` }
  }
  return { columns: out }
}

/**
 * Coerce one incoming cell value to its column's type. `null` means "clear this cell".
 *
 * A FORMULA bypasses the column type entirely: it's stored as `{ f }` and its result is computed at
 * render, so a formula in a currency column is still a formula, not the string "=SUM(...)".
 * The client sends it already translated into id-space (see sheet-formula.ts toStored).
 *
 * NEVER silently drops input (11 Oct 2026): text that doesn't parse as the column's type is kept as
 * text — "abc" typed into a Rupiah column used to become 0, and "Rp 1.500.000" became nothing.
 * Numbers are read the Indonesian way ("1.500" is 1500, "1,5" is 1.5) by the same parser the grid uses.
 *
 * `detect` (import, API clients that send raw text) turns "Rp 1.500.000" / "15%" / "11/10/2026" in a
 * text column into a typed value, exactly like typing it in the grid does.
 */
export function coerceCellValue(
  type: SheetColumnType,
  value: unknown,
  opts: { detect?: boolean } = {},
): string | number | boolean | string[] | FormulaCell | LinkCell | TypedCell | null {
  if (value === null || value === undefined || value === "") return null
  if (isFormulaCell(value)) {
    const f = value.f.slice(0, 2000)
    return f.trim() ? { f } : null
  }
  if (type === "multiselect") {
    const list = readMulti(value)
    return list.length ? list : null
  }
  if (type === "link") {
    // Either half may be missing: a label with no URL is just text, a URL with no label shows itself.
    const src = isLinkCell(value) ? value : { t: String(value), u: String(value) }
    const u = safeUrl(src.u)
    const t = String(src.t ?? "").trim().slice(0, 500)
    if (!u) return t || null
    return { t: t || u, u }
  }
  // A typed number ({ v, nf }) from the grid's value detection.
  if (isTypedCell(value)) {
    const typed: TypedCell = { v: value.v, nf: value.nf }
    if (type === "date") return typed.nf === "date" ? serialToIso(typed.v) : typed
    if ((type === "number" || type === "currency") && (typed.nf === "num" || typed.nf === "idr")) return typed.v
    if (type === "checkbox") return typed.v !== 0
    if (type === "select" || type === "task") return String(typed.v)
    return typed
  }
  // A link in a TEXT column stays a link (Sheets lets any cell hold one: Insert link).
  if (type === "text" && isLinkCell(value)) {
    const u = safeUrl(value.u)
    const t = String(value.t ?? "").trim().slice(0, 500)
    return u ? { t: t || u, u } : t || null
  }
  // A list or a link arriving in another plain column reads as its text — never "[object Object]".
  if (Array.isArray(value)) value = value.map(String).join(", ")
  else if (isLinkCell(value)) value = value.t || value.u
  else if (value && typeof value === "object") return JSON.stringify(value).slice(0, 5000)
  if (value === "") return null
  switch (type) {
    case "number":
    case "currency": {
      if (typeof value === "number") return Number.isFinite(value) ? value : null
      if (typeof value === "boolean") return value ? 1 : 0
      const raw = String(value).trim()
      const d = detectInput(raw)
      if (d.kind === "empty") return null
      if (d.kind === "number") {
        if (d.nf === "pct" || d.nf === "date") return { v: d.v, nf: d.nf }
        return d.v
      }
      // In a NUMBER column "007" is just 7 (text columns keep leading zeros: phone numbers).
      const plain = parseLocaleNumber(raw)
      if (plain) return plain.n
      return raw.slice(0, 5000)
    }
    case "checkbox": {
      if (typeof value === "boolean") return value
      const s = String(value).trim().toLowerCase()
      return ["true", "1", "ya", "yes", "y", "✓", "x"].includes(s)
    }
    case "date": {
      if (typeof value === "number") return Number.isFinite(value) ? serialToIso(value) : null
      const s = String(value).trim()
      // Day first: "11/10/2026" is 11 October. (new Date() would read it as 10 November.)
      const serial = parseDateText(s)
      return serial === null ? s.slice(0, 500) : serialToIso(serial)
    }
    case "task":
      // The cell holds a task id; the UI resolves it to a title. Never reformatted.
      return String(value).slice(0, 60)
    default: {
      if (typeof value === "number") return Number.isFinite(value) ? value : null
      if (typeof value === "boolean") return value
      const text = String(value).slice(0, 5000)
      if (!opts.detect) return text
      const d = detectInput(text)
      if (d.kind === "empty") return null
      if (d.kind === "number") return d.nf ? { v: d.v, nf: d.nf } : d.v
      return text
    }
  }
}

/** Rows come back from Prisma as `Json`. */
/** Row height bounds, in pixels. The default lives in the client; NULL in the DB means "default". */
export const ROW_HEIGHT_MIN = 20
export const ROW_HEIGHT_MAX = 400

/**
 * A clickable cell: `u` is the URL, `t` the label shown in its place.
 *
 * Stored as an object for the same reason a formula is — a link is genuinely two values, and
 * flattening it into one string would mean inventing a separator that some label eventually contains.
 */
export type LinkCell = { t: string; u: string }

export function isLinkCell(v: unknown): v is LinkCell {
  return Boolean(v) && typeof v === "object" && typeof (v as LinkCell).u === "string"
}

/**
 * Only http(s) survives. A `javascript:` or `data:` href in a cell would be stored XSS that fires the
 * moment a colleague clicks it, and no spreadsheet needs those schemes.
 */
export function safeUrl(raw: unknown): string {
  const v = String(raw ?? "").trim()
  if (!v) return ""
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(withScheme)
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString().slice(0, 2000) : ""
  } catch {
    return ""
  }
}

/** How many choices one multi-select cell may hold. */
export const MAX_MULTI_VALUES = 50

/**
 * Values of a multi-select cell, from either shape it can arrive in.
 *
 * A plain comma string is accepted on purpose: real sheets are full of columns like
 * "Suwara, ViralZ" typed into a single-choice dropdown, so switching such a column to Multi-pilihan
 * has to just work instead of needing a data migration first.
 */
export function readMulti(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value.map((v) => String(v))
    : String(value ?? "").split(",")
  return [...new Set(list.map((v) => v.trim()).filter(Boolean))].map((v) => v.slice(0, 80)).slice(0, MAX_MULTI_VALUES)
}

export function readCells(raw: unknown): Record<string, string | number | boolean | string[] | FormulaCell | LinkCell | TypedCell> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string | number | boolean | string[] | FormulaCell | LinkCell | TypedCell>
}
