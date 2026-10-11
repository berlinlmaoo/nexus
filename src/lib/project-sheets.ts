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

/** Palette for text and fill colours. Named tokens, never free hex: a sheet can't drift off the app's palette. */
export const STYLE_COLORS = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink", "slate", "black"] as const
export type StyleColor = (typeof STYLE_COLORS)[number]
export const STYLE_NUMBER_FORMATS = ["auto", "num", "idr", "pct", "date", "text"] as const

/**
 * One cell's formatting. Short keys because it is stored per cell:
 *   b bold · i italic · s strikethrough · u underline · fc text colour · bg fill colour
 *   ha horizontal align l|c|r · va vertical align t|m|b · w wrap · fs font size (px)
 *   nf number format (auto|num|idr|pct|date|text) · dp decimals · bd borders ("tblr" sides)
 */
export type CellStyle = {
  b?: 1; i?: 1; s?: 1; u?: 1
  fc?: StyleColor; bg?: StyleColor
  ha?: "l" | "c" | "r"; va?: "t" | "m" | "b"
  w?: 1; fs?: number
  nf?: (typeof STYLE_NUMBER_FORMATS)[number]; dp?: number
  bd?: string
}

/** Validate one incoming style; null/empty means "no formatting". Unknown keys are dropped. */
export function normalizeCellStyle(raw: unknown): CellStyle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const out: CellStyle = {}
  for (const k of ["b", "i", "s", "u", "w"] as const) if (o[k] === 1 || o[k] === true) out[k] = 1
  if (STYLE_COLORS.includes(o.fc as StyleColor)) out.fc = o.fc as StyleColor
  if (STYLE_COLORS.includes(o.bg as StyleColor)) out.bg = o.bg as StyleColor
  if (o.ha === "l" || o.ha === "c" || o.ha === "r") out.ha = o.ha
  if (o.va === "t" || o.va === "m" || o.va === "b") out.va = o.va
  if (typeof o.fs === "number" && o.fs >= 8 && o.fs <= 36) out.fs = Math.round(o.fs)
  if (STYLE_NUMBER_FORMATS.includes(o.nf as CellStyle["nf"] & string) && o.nf !== "auto") out.nf = o.nf as CellStyle["nf"]
  if (typeof o.dp === "number" && o.dp >= 0 && o.dp <= 10) out.dp = Math.round(o.dp)
  if (typeof o.bd === "string") {
    const sides = [...new Set(o.bd.split(""))].filter((c) => "tblr".includes(c)).sort().join("")
    if (sides) out.bd = sides
  }
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
  colors?: Record<string, StyleColor>
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
      const colors: Record<string, StyleColor> = {}
      for (const [k, v] of Object.entries(o.colors as Record<string, unknown>)) if (STYLE_COLORS.includes(v as StyleColor)) colors[k.slice(0, 200)] = v as StyleColor
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
export type SheetSettings = {
  frozenRows?: number
  frozenCols?: number
  tabColor?: ColumnColor
  hiddenRows?: string[]
  hiddenCols?: string[]
  merges?: SheetMerge[]
  validations?: SheetValidation[]
}

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
  return out
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
