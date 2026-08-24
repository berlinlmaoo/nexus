// Per-project spreadsheet: shared types, first-open seeding, and access resolution.
//
// This is NOT the Table view. ProjectTableView renders TASKS with custom-field columns; a sheet's
// rows are free-form and belong to nothing.
import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import type { ProjectRole } from "@/generated/prisma/client"
import { isFormulaCell, type FormulaCell } from "@/lib/sheet-formula"

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
const DEFAULT_ROW_COUNT = 50

/**
 * Give a project its default sheet so the tab is never empty.
 *
 * Idempotent and race-safe via an advisory lock, the same shape as ensurePnlDefaults in
 * src/lib/pnl.ts — two tabs opening the view at once can't create two sheets, and an existing sheet
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

type AccessOk = { allowed: true; sheet: { id: string; projectId: string; name: string; columns: SheetColumn[] } }
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
  const sheet = await prisma.projectSheet.findUnique({
    where: { id: sheetId },
    select: { id: true, projectId: true, name: true, columns: true },
  })
  if (!sheet) return { allowed: false, status: 404, error: "Sheet-nya nggak ketemu." }
  const { allowed } = await checkProjectAccess(userId, sheet.projectId, roles)
  if (!allowed) return { allowed: false, status: 403, error: "Kamu nggak punya akses ke sheet ini." }
  return { allowed: true, sheet: { ...sheet, columns: readColumns(sheet.columns) } }
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
 */
export function coerceCellValue(type: SheetColumnType, value: unknown): string | number | boolean | string[] | FormulaCell | LinkCell | null {
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
  switch (type) {
    case "number":
    case "currency": {
      // Accept what people actually paste: "Rp 1.500.000", "1,500.00", "(250)" for negatives.
      const raw = String(value).trim()
      const negative = /^\(.*\)$/.test(raw)
      const cleaned = raw.replace(/[()]/g, "").replace(/[^\d.,-]/g, "")
      // Indonesian "1.500.000,50" vs English "1,500,000.50": whichever separator comes LAST is the
      // decimal point.
      const lastDot = cleaned.lastIndexOf(".")
      const lastComma = cleaned.lastIndexOf(",")
      let normalized = cleaned
      if (lastComma > lastDot) normalized = cleaned.replace(/\./g, "").replace(",", ".")
      else normalized = cleaned.replace(/,/g, "")
      const n = Number(normalized)
      if (!Number.isFinite(n)) return null
      return negative ? -Math.abs(n) : n
    }
    case "checkbox": {
      if (typeof value === "boolean") return value
      const s = String(value).trim().toLowerCase()
      return ["true", "1", "ya", "yes", "y", "✓", "x"].includes(s)
    }
    case "date": {
      const s = String(value).trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
      const d = new Date(s)
      return Number.isNaN(d.getTime()) ? String(value).slice(0, 500) : d.toISOString().slice(0, 10)
    }
    case "task":
      // The cell holds a task id; the UI resolves it to a title. Never reformatted.
      return String(value).slice(0, 60)
    default:
      return String(value).slice(0, 5000)
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

export function readCells(raw: unknown): Record<string, string | number | boolean | string[] | FormulaCell | LinkCell> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string | number | boolean | string[] | FormulaCell | LinkCell>
}
