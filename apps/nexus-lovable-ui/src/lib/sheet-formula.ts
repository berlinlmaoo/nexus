// Spreadsheet formula engine, value parsing and display formatting.
//
// ⚠️ MIRRORED FILE — keep in sync with src/lib/sheet-formula.ts in the Next.js backend.
// The SPA is a separate Vite package and can't import from src/lib, so this exists twice, the same
// way src/lib/gamification.ts is mirrored by the SPA's lib/levels.ts. The client evaluates for
// display; the server needs the identical result for export and for GET /api/sheets/:id?computed=1.
// apps/nexus-lovable-ui/src/lib/sheet-formula.test.mjs fails when the two copies differ.
//
// ── Decisions that keep formulas from wrecking the data model ────────────────────────────────────
//
// 1. STORED IN ID-SPACE, DISPLAYED IN A1-SPACE.
//    A cell never stores "=SUM(B2:B9)". It stores references to column ids and row ids
//    ("{c_1!rowid}", "$" kept for absolute parts, "{c_1!*}" for a whole column). A1 letters are a
//    display layer computed from the CURRENT positions, so inserting a row or reordering columns
//    never rewrites a formula. Deleting a range's corner row/column is the one structural change
//    that does: the server shrinks the range (rewriteForDeletion), like Sheets.
//
// 2. EVALUATED, NEVER STORED.
//    A formula cell holds only { f: "..." }; the computed value is never written back. That keeps a
//    cell save as the single atomic `cells || $patch` UPDATE. Values are cached per SheetData object
//    (SheetEngine), with a dependency graph so an edit only recomputes what depends on it.
//
// 3. ONE LOCALE FOR DATA: INDONESIAN.
//    "1.500.000", "Rp 1.500.000", "1,5", "15%" and "11/10/2026" (11 Oct) are what people type here.
//    detectInput turns them into numbers / date serials plus a display format (TypedCell); text that
//    is not clearly a number stays text, and nothing is ever silently dropped.
//    A spreadsheet may switch its DISPLAY locale to en-US (File › Settings): setDisplayLocale then
//    changes how numbers/dates read and are typed ("1,500.25", month-first dates). Stored values and
//    formula separators never depend on it; id-ID is the default and behaves exactly as before.
//
// Functions beyond the core set come from @formulajs/formulajs (MIT). HyperFormula is GPLv3 and must
// not be used here.

import {
  CEILING, CHAR, CHOOSE, CLEAN, CODE, DAYS, DAYS360, EDATE, EOMONTH, EXACT, EXP, FLOOR, FV, INDEX, IPMT, IRR,
  ISEVEN, ISODD, ISOWEEKNUM, LARGE, LN, LOG, LOG10, MATCH, MODESNGL, MROUND, NETWORKDAYS, NETWORKDAYSINTL, NPER,
  NPV, PERCENTILEINC, PI, PMT, PPMT, PROPER, PV, QUARTILEINC, RAND, RANDBETWEEN, RANKEQ, RATE, REPLACE, REPT,
  SEARCH, SIGN, SMALL, STDEVP, STDEVS, SUMPRODUCT, SWITCH, TEXTJOIN, TRUNC, VARP, VARS, WEEKDAY, WEEKNUM,
  WORKDAY, WORKDAYINTL, XOR, YEARFRAC,
} from "@formulajs/formulajs"

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Values
// ═════════════════════════════════════════════════════════════════════════════════════════════════

export type CellValue = string | number | boolean | null
export type FormulaCell = { f: string }

export const isFormulaCell = (v: unknown): v is FormulaCell =>
  Boolean(v) && typeof v === "object" && typeof (v as FormulaCell).f === "string"

/** Display formats a detected number carries: grouped number, Rupiah, percent, date (serial). */
export type NumFmt = "num" | "idr" | "pct" | "date"
export const NUM_FORMATS: readonly NumFmt[] = ["num", "idr", "pct", "date"]

/**
 * A number typed into a text column, with the format it was typed in. Stored as { v, nf } so
 * "Rp 1.500.000" sums as 1500000 and still reads as "Rp 1.500.000"; a date is a serial
 * (days since 1899-12-30, the Excel/Sheets epoch) so date arithmetic is plain subtraction.
 */
export type TypedCell = { v: number; nf: NumFmt }
export const isTypedCell = (v: unknown): v is TypedCell =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v) &&
  typeof (v as TypedCell).v === "number" && Number.isFinite((v as TypedCell).v) &&
  (NUM_FORMATS as readonly string[]).includes((v as TypedCell).nf)

const isLinkLike = (v: unknown): v is { t?: string; u: string } =>
  Boolean(v) && typeof v === "object" && typeof (v as { u?: unknown }).u === "string"

export const ERR = {
  ref: "#REF!",
  div: "#DIV/0!",
  cycle: "#CIRCULAR!",
  name: "#NAME?",
  value: "#VALUE!",
  na: "#N/A",
  num: "#NUM!",
  /** The formula's "," could mean a decimal or an argument separator — refused rather than guessed. */
  error: "#ERROR!",
} as const
export type ErrorValue = (typeof ERR)[keyof typeof ERR]
// "#CYCLE!" is what this engine printed before 11 Oct 2026; still recognised so nothing old breaks.
const ERROR_TEXTS = new Set<string>([...Object.values(ERR), "#CYCLE!", "#NULL!", "#CALC!", "#ERROR!"])
export const isError = (v: unknown): v is ErrorValue => typeof v === "string" && ERROR_TEXTS.has(v)

/** Errors that are not "#CIRCULAR!" read as Sheets' own names; this one is ours, so explain it. */
export function errorHint(v: string, lang: "en" | "id" = "id"): string {
  const id: Record<string, string> = {
    "#REF!": "Rujukan ke sel/kolom yang sudah dihapus atau di luar sheet.",
    "#DIV/0!": "Pembagian dengan nol.",
    "#CIRCULAR!": "Rumus ini merujuk dirinya sendiri (langsung atau lewat sel lain).",
    "#NAME?": "Nama fungsi tidak dikenal.",
    "#VALUE!": "Jenis isi salah, mis. teks dipakai sebagai angka.",
    "#N/A": "Nilai yang dicari tidak ketemu.",
    "#NUM!": "Angka tidak valid untuk fungsi ini.",
    "#ERROR!": "Koma di rumus ini bisa berarti desimal atau pemisah. Pakai ; sebagai pemisah argumen, mis. =IF(A1>1;1,5;0).",
  }
  const en: Record<string, string> = {
    "#REF!": "Refers to a deleted cell/column or one outside the sheet.",
    "#DIV/0!": "Division by zero.",
    "#CIRCULAR!": "This formula refers to itself (directly or through other cells).",
    "#NAME?": "Unknown function name.",
    "#VALUE!": "Wrong kind of value, e.g. text used as a number.",
    "#N/A": "The value looked up was not found.",
    "#NUM!": "Invalid number for this function.",
    "#ERROR!": "A comma in this formula could be a decimal point or a separator. Separate arguments with ;, e.g. =IF(A1>1;1,5;0).",
  }
  return (lang === "en" ? en : id)[v] ?? ""
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Dates (serials, Asia/Jakarta)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** The spreadsheet's display locale (settings.locale). Module-level: set it before rendering/computing. */
export type DisplayLocale = "id-ID" | "en-US"
let displayLocale: DisplayLocale = "id-ID"
export function setDisplayLocale(l: DisplayLocale): void { displayLocale = l === "en-US" ? "en-US" : "id-ID" }
export function getDisplayLocale(): DisplayLocale { return displayLocale }
const isEn = () => displayLocale === "en-US"
/** Decimal and grouping marks of the display locale. */
export const decimalMark = (): string => (isEn() ? "." : ",")
export const groupMark = (): string => (isEn() ? "," : ".")

const EPOCH_MS = Date.UTC(1899, 11, 30)
const DAY_MS = 86_400_000
/** Asia/Jakarta is UTC+7 all year (no DST), so "today" never needs a tz database. */
const JAKARTA_OFFSET_MS = 7 * 3_600_000

export function ymdToSerial(y: number, m: number, d: number): number {
  const ms = Date.UTC(y, m - 1, d)
  // Date.UTC maps years 0–99 to 1900–1999; correct for that so DATE(26;1;1) is not 1926.
  const fixed = y >= 0 && y < 100 ? new Date(ms).setUTCFullYear(y) : ms
  return Math.round((fixed - EPOCH_MS) / DAY_MS)
}
export function serialToYmd(serial: number): { y: number; m: number; d: number } {
  const dt = new Date(EPOCH_MS + Math.floor(serial) * DAY_MS)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
const pad2 = (n: number) => String(n).padStart(2, "0")
export function serialToIso(serial: number): string {
  const { y, m, d } = serialToYmd(serial)
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
function validYmd(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m)
}
/** "2026-10-11" -> serial; anything else -> null. */
export function isoToSerial(s: unknown): number | null {
  if (typeof s !== "string") return null
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim())
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  return validYmd(y, mo, d) ? ymdToSerial(y, mo, d) : null
}
/** Today in Asia/Jakarta as a serial — TODAY() must not flip at 07:00 WIB because the server is UTC. */
export function todaySerial(now: Date = new Date()): number {
  const j = new Date(now.getTime() + JAKARTA_OFFSET_MS)
  return ymdToSerial(j.getUTCFullYear(), j.getUTCMonth() + 1, j.getUTCDate())
}
function nowSerial(now: Date = new Date()): number {
  const j = now.getTime() + JAKARTA_OFFSET_MS
  return (j - EPOCH_MS) / DAY_MS
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, nop: 11, november: 11, nopember: 11,
  des: 12, desember: 12, dec: 12, december: 12,
}
const MONTH_SHORT_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const MONTH_LONG_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
const DAY_LONG_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
const DAY_SHORT_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]
const MONTH_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTH_LONG_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DAY_LONG_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const DAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
/** Month (1–12) / weekday (0 = Sunday) names in the display locale. */
export function monthName(m: number, long: boolean): string {
  return (long ? (isEn() ? MONTH_LONG_EN : MONTH_LONG_ID) : (isEn() ? MONTH_SHORT_EN : MONTH_SHORT_ID))[m - 1] ?? ""
}
export function weekdayName(dow: number, long: boolean): string {
  return (long ? (isEn() ? DAY_LONG_EN : DAY_LONG_ID) : (isEn() ? DAY_SHORT_EN : DAY_SHORT_ID))[dow] ?? ""
}
/** 0 = Sunday; serial 0 (1899-12-30) was a Saturday. */
const weekdayOf = (serial: number) => ((Math.floor(serial) % 7) + 7 + 6) % 7

/**
 * A date as Indonesians type it, to a serial. Day comes FIRST: "11/10/2026" is 11 October.
 * Accepts dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, dd/mm/yy, yyyy-mm-dd, "11 Okt 2026", "11 Oktober 2026",
 * "Oct 11, 2026". Returns null for anything that isn't a real calendar date (31/02/2026 stays text).
 */
export function parseDateText(raw: string): number | null {
  const s = raw.trim()
  const iso = isoToSerial(s)
  if (iso !== null) return iso
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/.exec(s)
  if (m) {
    // en-US display locale: month first ("9/26/2008").
    const d = Number(isEn() ? m[2] : m[1]), mo = Number(isEn() ? m[1] : m[2])
    let y = Number(m[3])
    if (m[3].length === 2) y += 2000
    return validYmd(y, mo, d) ? ymdToSerial(y, mo, d) : null
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(s)
  if (m) {
    const d = Number(m[1]), mo = MONTHS[m[2].toLowerCase()], y = Number(m[3])
    return mo && validYmd(y, mo, d) ? ymdToSerial(y, mo, d) : null
  }
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()], d = Number(m[2]), y = Number(m[3])
    return mo && validYmd(y, mo, d) ? ymdToSerial(y, mo, d) : null
  }
  return null
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Numbers as typed in Indonesia
// ═════════════════════════════════════════════════════════════════════════════════════════════════

function validGrouping(x: string, g: string): boolean {
  const parts = x.split(g)
  if (!/^\d{1,3}$/.test(parts[0])) return false
  return parts.slice(1).every((p) => /^\d{3}$/.test(p))
}

/**
 * "1.500.000" -> 1500000, "1,5" -> 1.5, "1.500" -> 1500, "1.5" -> 1.5, "1,500,000.50" -> 1500000.5,
 * "(250)" -> -250. Indonesian rules: "." groups thousands and "," is the decimal point — except that
 * when BOTH appear, whichever comes last is the decimal point (so English exports still parse), and a
 * lone "." not followed by exactly three digits is a decimal point ("1.5", "0.500").
 * In the en-US display locale the two marks swap roles ("1,500.25", "1,500" = 1500, "0.256").
 * `separators` is true when the text used any grouping/decimal mark (decides whether to keep a format).
 */
export function parseLocaleNumber(raw: string): { n: number; separators: boolean } | null {
  let s = raw.trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim() }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1).trim() }
  else if (s.startsWith("+")) s = s.slice(1).trim()
  if (!/^(\d[\d.,]*|[.,]\d+)$/.test(s)) return null
  if (/[.,]$/.test(s)) return null
  const dots = (s.match(/\./g) ?? []).length
  const commas = (s.match(/,/g) ?? []).length
  let intPart = s
  let frac = ""
  if (dots && commas) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ","
    const grp = dec === "." ? "," : "."
    const parts = s.split(dec)
    if (parts.length !== 2) return null
    if (!validGrouping(parts[0], grp)) return null
    intPart = parts[0].split(grp).join("")
    frac = parts[1]
  } else if (dots || commas) {
    const ch = dots ? "." : ","
    const parts = s.split(ch)
    if (parts.length > 2) {
      if (!validGrouping(s, ch)) return null
      intPart = parts.join("")
    } else {
      const [a, b] = parts
      // A lone grouping mark ("." in id-ID, "," in en-US) groups only when exactly three digits follow.
      const looksGrouped = ch === groupMark() && b.length === 3 && /^[1-9]\d{0,2}$/.test(a)
      if (looksGrouped) intPart = a + b
      else { intPart = a; frac = b }
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || intPart + frac === "") return null
  const n = Number(`${intPart || "0"}.${frac || "0"}`)
  if (!Number.isFinite(n)) return null
  return { n: neg ? -n : n, separators: dots + commas > 0 }
}

export type Detected =
  | { kind: "empty" }
  | { kind: "text"; v: string }
  | { kind: "number"; v: number; nf: NumFmt | null }

/**
 * What a piece of typed/pasted text IS. Used for text columns, paste and import.
 *
 * Deliberately conservative where a wrong guess destroys information: a leading zero ("0812…"),
 * a leading "+" (phone numbers), or more than 15 digits (NIK, account numbers) stays text, because a
 * number would drop the zero / round the digits.
 */
export function detectInput(text: string): Detected {
  const s = text.trim()
  if (!s) return { kind: "empty" }
  if (s.length > 40) return { kind: "text", v: text }
  const digits = (s.match(/\d/g) ?? []).length
  if (!digits) return { kind: "text", v: text }
  if (s.startsWith("+")) return { kind: "text", v: text }

  // Percent: "15%", "1,5 %", "-2%"
  let m = /^(.*?)\s*%$/.exec(s)
  if (m) {
    const p = parseLocaleNumber(m[1])
    return p ? { kind: "number", v: p.n / 100, nf: "pct" } : { kind: "text", v: text }
  }
  // Rupiah: "Rp 1.500.000", "Rp1.500.000,-", "-Rp 5.000", "Rp -5.000", "IDR 1.500.000"
  m = /^(-?)\s*(?:rp\.?|idr)\s*(-?)\s*([\d.,]+?)(?:,-)?$/i.exec(s)
  if (m) {
    const p = parseLocaleNumber(m[3])
    if (!p) return { kind: "text", v: text }
    const neg = (m[1] === "-") !== (m[2] === "-")
    return { kind: "number", v: neg ? -p.n : p.n, nf: "idr" }
  }
  const date = parseDateText(s)
  if (date !== null) return { kind: "number", v: date, nf: "date" }

  const p = parseLocaleNumber(s)
  if (!p) return { kind: "text", v: text }
  const bare = s.replace(/^[-(]+|\)$/g, "")
  if (/^0\d/.test(bare)) return { kind: "text", v: text } // "0812…", "007"
  if (digits > 15) return { kind: "text", v: text }
  return { kind: "number", v: p.n, nf: p.separators ? "num" : null }
}

/** Numeric value of text that is clearly a number/Rupiah/percent/date, else null. */
export function numberFromText(s: string): number | null {
  const iso = isoToSerial(s)
  if (iso !== null) return iso
  const d = detectInput(s)
  return d.kind === "number" ? d.v : null
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Display formatting (shared by the grid and GET ?computed=1, so web and mobile read the same text)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

const nfCache = new Map<string, Intl.NumberFormat>()
function numberFormat(maxFrac: number, grouping: boolean, minFrac = 0): Intl.NumberFormat {
  const key = `${displayLocale}|${maxFrac}|${grouping}|${minFrac}`
  let f = nfCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(displayLocale, { maximumFractionDigits: maxFrac, minimumFractionDigits: minFrac, useGrouping: grouping })
    nfCache.set(key, f)
  }
  return f
}
export const formatRupiah = (n: number) => `Rp ${numberFormat(2, true).format(n)}`
export const formatGrouped = (n: number, maxFrac = 2) => numberFormat(maxFrac, true).format(n)

/** "11 Okt 2026" — the same text the date column has always shown ("Oct 11, 2026" in en-US). */
export function formatDateSerial(serial: number): string {
  if (!Number.isFinite(serial)) return String(serial)
  const { y, m, d } = serialToYmd(serial)
  if (isEn()) return `${MONTH_SHORT_EN[m - 1]} ${d}, ${y}`
  return `${pad2(d)} ${MONTH_SHORT_ID[m - 1]} ${y}`
}
/** What goes back into the editor for a date: day first, like it was typed (en-US: "9/26/2008"). */
export function editDateSerial(serial: number): string {
  const { y, m, d } = serialToYmd(serial)
  if (isEn()) return `${m}/${d}/${y}`
  return `${pad2(d)}/${pad2(m)}/${y}`
}

/** A value with an explicit format. Errors print as-is: formatting them would hide the problem. */
export function formatValue(v: CellValue, nf: NumFmt | null): string {
  if (v === null || v === "") return ""
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
  if (typeof v === "string") {
    if (nf === "date") { const s = isoToSerial(v); if (s !== null) return formatDateSerial(s) }
    return v
  }
  if (!Number.isFinite(v)) return ERR.num
  switch (nf) {
    case "idr": return formatRupiah(v)
    case "num": return formatGrouped(v, 6)
    case "pct": return `${numberFormat(4, true).format(v * 100)}%`
    // A date typed as "11/10/2026" keeps that style (date COLUMNS show "11 Okt 2026", see formatScalar).
    case "date": return editDateSerial(v)
    default:
      // General: no grouping, decimals as needed (Sheets' "Automatic"), Indonesian decimal comma.
      return numberFormat(10, false).format(v)
  }
}

/** The text a TypedCell is edited as — re-parsing it gives the same value and format back. */
export function editTyped(c: TypedCell): string {
  switch (c.nf) {
    case "idr": return formatRupiah(c.v)
    case "num": return formatGrouped(c.v, 10)
    case "pct": return `${numberFormat(10, true).format(c.v * 100)}%`
    case "date": return editDateSerial(c.v)
  }
}

/**
 * A plain stored scalar under its column type: what the cell has always shown.
 * (Number/Rupiah columns keep their 2-decimal grouping; date columns show "11 Okt 2026".)
 */
export function formatScalar(type: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return ""
  if (Array.isArray(value)) return value.join(", ")
  if (isTypedCell(value)) return formatValue(value.v, value.nf)
  if (isLinkLike(value)) return value.t || value.u
  if (typeof value === "object") return ""
  switch (type) {
    case "currency":
      return typeof value === "number" ? formatRupiah(value) : String(value)
    case "number":
      return typeof value === "number" ? formatGrouped(value) : String(value)
    case "date": {
      if (typeof value === "number") return formatDateSerial(value)
      const s = parseDateText(String(value))
      return s === null ? String(value) : formatDateSerial(s)
    }
    case "checkbox":
      return value ? "✓" : ""
    default:
      if (typeof value === "number") return formatValue(value, null)
      if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
      return String(value)
  }
}

/**
 * A number under a cell's EXPLICIT number format (toolbar: Rupiah, %, decimals, date, plain text).
 * `nf` is the style's format ("auto" or undefined = keep the inferred one), `dp` its decimals.
 * Returns null when the style doesn't change how this value reads (not a number, or no format).
 */
export function formatWithStyle(v: CellValue, nf: string | undefined, dp: number | undefined, inferred: NumFmt | null = null, pt?: string): string | null {
  // A custom pattern's 4th section (or a lone "@" section) formats text too.
  if (nf === "custom" && pt && typeof v === "string" && v !== "" && !isError(v)) {
    const r = formatNumberPattern(v, pt).text
    return r === v ? null : r
  }
  if (typeof v !== "number" || !Number.isFinite(v)) return null
  if ((!nf || nf === "auto") && dp === undefined) return null
  const kind = !nf || nf === "auto" ? inferred : nf
  const fixed = dp ?? 2
  const sym = currencySymbol()
  switch (kind) {
    case "idr": return `Rp ${numberFormat(dp ?? 2, true, dp ?? 0).format(v)}`
    case "pct": return `${numberFormat(dp ?? 2, true, dp ?? 0).format(v * 100)}%`
    case "date": return editDateSerial(v)
    case "text": return String(v)
    case "sci": return formatNumberPattern(v, `0${fixed > 0 ? "." + "0".repeat(fixed) : ""}E+00`).text
    case "acct": {
      // Sheets' accounting: symbol at the left edge, negatives in brackets, zero as a dash; the
      // trailing space lines positives up with the ")" of negatives.
      if (v === 0) return `${sym} - `
      const body = numberFormat(fixed, true, fixed).format(Math.abs(v))
      return v < 0 ? `${sym} (${body})` : `${sym} ${body} `
    }
    case "fin": {
      const body = numberFormat(fixed, true, fixed).format(Math.abs(v))
      return v < 0 ? `(${body})` : body
    }
    case "cur":
    case "cur0": {
      const d = dp ?? (kind === "cur0" ? 0 : 2)
      const body = numberFormat(d, true, d).format(Math.abs(v))
      return `${v < 0 && /[1-9]/.test(body) ? "-" : ""}${sym}${body}`
    }
    case "time": return formatNumberPattern(v, isEn() ? "h:mm:ss AM/PM" : "hh.mm.ss").text
    case "dt": return formatNumberPattern(v, isEn() ? "m/d/yyyy hh:mm:ss" : "dd/mm/yyyy hh.mm.ss").text
    case "dur": return formatNumberPattern(v, "[h]:mm:ss").text
    case "custom": return pt ? formatNumberPattern(v, pt).text : null
    default: return numberFormat(dp ?? 2, true, dp ?? 0).format(v)
  }
}

/** The display locale's currency symbol (Format › Number › Currency): Rupiah, or the dollar in en-US. */
export const currencySymbol = (): string => (isEn() ? "$" : "Rp")

/** How many decimals a number shows right now (for the toolbar's "decimals −/+"). */
export function decimalsShown(text: string): number {
  const m = (isEn() ? /\.(\d+)/ : /,(\d+)/).exec(text.replace(/%$/, ""))
  return m ? m[1].length : 0
}

/** A formula's computed result under its column type and inferred format. */
export function formatResult(type: string, v: CellValue, nf: NumFmt | null): string {
  if (isError(v)) return v
  if (v === null || v === "") return ""
  if (type === "date" && typeof v === "number" && (nf === "date" || nf === null)) return formatScalar(type, v)
  if (nf) return formatValue(v, nf)
  if (typeof v === "number" && (type === "currency" || type === "number" || type === "date")) return formatScalar(type, v)
  if (type === "checkbox") return v === true || v === 1 ? "✓" : formatValue(v, null)
  return formatValue(v, null)
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Custom number formats (Sheets/Excel pattern syntax, Format › Number › Custom …)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// Up to four ";" sections (positive; negative; zero; text), [Red]/[Blue]/[ColorN] colours, [>100]
// conditions, 0 # ? digits, "," grouping / trailing-comma scaling, "." decimal point, %, E+00,
// fractions (# ?/?), _x padding, *x fill, "literal" and \x escapes, @ text, [$€] currency, and date
// tokens (d dd ddd dddd m … mmmmm yy yyyy h hh m mm s ss AM/PM A/P [h] [m] [s], .000 seconds).
// The pattern is in Sheets syntax ("," groups, "." is the decimal point) whatever the locale; the
// OUTPUT uses the display locale's marks and month names.

export type PatternResult = { text: string; color?: string }

type PTok =
  | { k: "lit"; s: string }
  | { k: "ph"; c: "0" | "#" | "?" }
  | { k: "dot" }
  | { k: "comma" }
  | { k: "pct" }
  | { k: "exp"; s: string; plus: boolean }
  | { k: "at" }
  | { k: "slash" }
  | { k: "digit"; s: string }
  | { k: "date"; s: string; raw: string }
  | { k: "ampm"; s: string }
  | { k: "elapsed"; u: "h" | "m" | "s"; n: number }
  | { k: "general" }
type PCond = { op: string; v: number }
type PSection = { toks: PTok[]; color?: string; cond?: PCond; date: boolean; text: boolean }

const PATTERN_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#00ff00", blue: "#0000ff",
  yellow: "#ffff00", magenta: "#ff00ff", cyan: "#00ffff",
}
/** Excel's 56-colour palette for [Color1]…[Color56]. */
const PATTERN_COLOR56 = [
  "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#800000", "#008000",
  "#000080", "#808000", "#800080", "#008080", "#c0c0c0", "#808080", "#9999ff", "#993366", "#ffffcc", "#ccffff",
  "#660066", "#ff8080", "#0066cc", "#ccccff", "#000080", "#ff00ff", "#ffff00", "#00ffff", "#800080", "#800000",
  "#008080", "#0000ff", "#00ccff", "#ccffff", "#ccffcc", "#ffff99", "#99ccff", "#ff99cc", "#cc99ff", "#ffcc99",
  "#3366ff", "#33cccc", "#99cc00", "#ffcc00", "#ff9900", "#ff6600", "#666699", "#969696", "#003366", "#339966",
  "#003300", "#333300", "#993300", "#993366", "#333399", "#333333",
]

function splitPatternSections(p: string): string[] {
  const out: string[] = []
  let cur = ""
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (ch === '"') {
      const j = p.indexOf('"', i + 1)
      const end = j < 0 ? p.length - 1 : j
      cur += p.slice(i, end + 1)
      i = end
    } else if (ch === "\\" || ch === "_" || ch === "*") {
      cur += ch + (p[i + 1] ?? "")
      i++
    } else if (ch === "[") {
      const j = p.indexOf("]", i)
      if (j < 0) { cur += ch; continue }
      cur += p.slice(i, j + 1)
      i = j
    } else if (ch === ";") {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out
}

function parsePatternSection(src: string): PSection {
  const toks: PTok[] = []
  let color: string | undefined
  let cond: PCond | undefined
  const lit = (s: string) => {
    const last = toks[toks.length - 1]
    if (last && last.k === "lit") last.s += s
    else toks.push({ k: "lit", s })
  }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    const rest = src.slice(i)
    if (ch === '"') {
      const j = src.indexOf('"', i + 1)
      const end = j < 0 ? src.length : j
      lit(src.slice(i + 1, end))
      i = end
      continue
    }
    if (ch === "\\") { if (i + 1 < src.length) lit(src[i + 1]); i++; continue }
    if (ch === "_") { lit(" "); i++; continue }
    if (ch === "*") { if (src[i + 1] === " ") lit(" "); i++; continue }
    if (ch === "[") {
      const j = src.indexOf("]", i)
      if (j < 0) { lit(ch); continue }
      const inner = src.slice(i + 1, j)
      i = j
      let m: RegExpExecArray | null
      if ((m = /^(h+|m+|s+)$/i.exec(inner))) toks.push({ k: "elapsed", u: m[1][0].toLowerCase() as "h" | "m" | "s", n: m[1].length })
      else if ((m = /^(<=|>=|<>|<|>|=)\s*(-?\d+(?:\.\d+)?)$/.exec(inner))) cond = { op: m[1], v: Number(m[2]) }
      else if ((m = /^\$([^-]*)(?:-[0-9a-f]+)?$/i.exec(inner))) { if (m[1]) lit(m[1]) }
      else if ((m = /^colou?r\s*(\d+)$/i.exec(inner))) color = PATTERN_COLOR56[Number(m[1]) - 1] ?? color
      else if (PATTERN_COLORS[inner.toLowerCase()]) color = PATTERN_COLORS[inner.toLowerCase()]
      continue
    }
    if (ch === "0" || ch === "#" || ch === "?") { toks.push({ k: "ph", c: ch }); continue }
    if (ch === ".") { toks.push({ k: "dot" }); continue }
    if (ch === ",") { toks.push({ k: "comma" }); continue }
    if (ch === "%") { toks.push({ k: "pct" }); continue }
    if (ch === "@") { toks.push({ k: "at" }); continue }
    if (ch === "/") { toks.push({ k: "slash" }); continue }
    if ((ch === "E" || ch === "e") && (src[i + 1] === "+" || src[i + 1] === "-")) {
      toks.push({ k: "exp", s: ch, plus: src[i + 1] === "+" })
      i++
      continue
    }
    if (/^[1-9]$/.test(ch)) { toks.push({ k: "digit", s: ch }); continue }
    if (/^general/i.test(rest)) { toks.push({ k: "general" }); i += 6; continue }
    if (/^am\/pm/i.test(rest)) { toks.push({ k: "ampm", s: rest.slice(0, 5) }); i += 4; continue }
    if (/^a\/p/i.test(rest)) { toks.push({ k: "ampm", s: rest.slice(0, 3) }); i += 2; continue }
    if (/[ymdhs]/i.test(ch)) {
      let j = i
      while (j + 1 < src.length && src[j + 1].toLowerCase() === ch.toLowerCase()) j++
      const raw = src.slice(i, j + 1)
      toks.push({ k: "date", s: raw.toLowerCase(), raw })
      i = j
      continue
    }
    lit(ch)
  }
  // A date/time section: date tokens and no digit placeholders, except ".000" fractional seconds.
  const hasDate = toks.some((t) => t.k === "date" || t.k === "ampm" || t.k === "elapsed")
  let fracSecondsOnly = true
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].k !== "ph") continue
    let j = i - 1
    while (j >= 0 && toks[j].k === "ph") j--
    const before = toks[j - 1]
    const ok = toks[j]?.k === "dot" && before !== undefined &&
      ((before.k === "date" && before.s[0] === "s") || (before.k === "elapsed" && before.u === "s"))
    if (!ok) { fracSecondsOnly = false; break }
  }
  const date = hasDate && fracSecondsOnly
  const text = !date && toks.some((t) => t.k === "at") && !toks.some((t) => t.k === "ph" || t.k === "general")
  return { toks, color, cond, date, text }
}

const patternCache = new Map<string, PSection[]>()
function patternSections(pattern: string): PSection[] {
  let secs = patternCache.get(pattern)
  if (!secs) {
    secs = splitPatternSections(pattern).slice(0, 4).map(parsePatternSection)
    if (patternCache.size > 500) patternCache.clear()
    patternCache.set(pattern, secs)
  }
  return secs
}

function condHolds(c: PCond, n: number): boolean {
  switch (c.op) {
    case "<": return n < c.v
    case "<=": return n <= c.v
    case ">": return n > c.v
    case ">=": return n >= c.v
    case "<>": return n !== c.v
    default: return n === c.v
  }
}

/** x rounded to f decimals as a plain digit string (no exponent for ordinary sizes). */
function fixedDigits(x: number, f: number): string {
  if (Math.abs(x) < 1e15) {
    const shifted = Number(`${x}e${f}`)
    if (Number.isFinite(shifted)) return (Math.round(shifted) / 10 ** f).toFixed(f)
  }
  return x.toFixed(f)
}

function groupDigits(digits: string): string {
  const sep = groupMark()
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}

/** Fill integer placeholders right-to-left; the leftmost one takes every remaining digit. */
function fillInt(digits: string, phs: ("0" | "#" | "?")[]): string[] {
  const out: string[] = new Array(phs.length).fill("")
  let rest = digits
  for (let k = phs.length - 1; k >= 0; k--) {
    if (rest) {
      if (k === 0) { out[k] = rest; rest = "" }
      else { out[k] = rest.slice(-1); rest = rest.slice(0, -1) }
    } else out[k] = phs[k] === "0" ? "0" : phs[k] === "?" ? " " : ""
  }
  return out
}

function phChars(toks: PTok[], idx: number[]): ("0" | "#" | "?")[] {
  return idx.map((i) => (toks[i] as { k: "ph"; c: "0" | "#" | "?" }).c)
}

function literalText(t: PTok): string {
  switch (t.k) {
    case "lit": case "digit": return t.s
    case "dot": return "."
    case "comma": return ","
    case "pct": return "%"
    case "slash": return "/"
    case "date": return t.raw
    case "ampm": return t.s
    case "exp": return t.s + (t.plus ? "+" : "-")
    case "ph": return t.c === "?" ? " " : t.c
    default: return ""
  }
}

/** Plain digits (0 # ?), grouping, scaling, decimals, % — no exponent, no fraction. x >= 0. */
function renderPlainNumber(x: number, toks: PTok[]): string {
  const ph = toks.flatMap((t, i) => (t.k === "ph" ? [i] : []))
  if (!ph.length) return toks.map((t) => (t.k === "general" ? formatValue(x, null) : t.k === "at" ? formatValue(x, null) : literalText(t))).join("")
  const first = ph[0], last = ph[ph.length - 1]
  let dec = -1
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].k !== "dot") continue
    if ((i > first && i <= last + 1) || i === first - 1) { dec = i; break }
  }
  const intIdx = ph.filter((i) => dec < 0 || i < dec)
  const fracIdx = ph.filter((i) => dec >= 0 && i > dec)
  // Commas: between integer placeholders = grouping; right after the last integer placeholder = ÷1000 each.
  const skip = new Set<number>()
  let grouping = false
  let scale = 0
  if (intIdx.length) {
    const li = intIdx[intIdx.length - 1]
    for (let i = intIdx[0] + 1; i < li; i++) if (toks[i].k === "comma") { grouping = true; skip.add(i) }
    for (let i = li + 1; i < toks.length && toks[i].k === "comma"; i++) { scale++; skip.add(i) }
  }
  const pcts = toks.filter((t) => t.k === "pct").length
  const value = (x * 100 ** pcts) / 1000 ** scale
  const fixed = fixedDigits(value, fracIdx.length)
  const [intRaw, fracRaw = ""] = fixed.split(".")
  const intDigits = intRaw === "0" ? "" : intRaw
  const intPh = phChars(toks, intIdx)
  const intFill = fillInt(intDigits, intPh)
  const intMap = new Map<number, string>()
  if (grouping) {
    const joined = intFill.join("")
    const lead = /^ */.exec(joined)?.[0] ?? ""
    intMap.set(intIdx[0], lead + groupDigits(joined.slice(lead.length)))
    for (const i of intIdx.slice(1)) intMap.set(i, "")
  } else intIdx.forEach((i, k) => intMap.set(i, intFill[k]))
  // Fraction digits: trailing zeros vanish under "#", turn into spaces under "?".
  const fracPh = phChars(toks, fracIdx)
  const fracOut = fracRaw.split("")
  for (let k = fracOut.length - 1; k >= 0; k--) {
    if (fracOut[k] !== "0" || fracPh[k] === "0") break
    fracOut[k] = fracPh[k] === "?" ? " " : ""
  }
  const fracMap = new Map<number, string>()
  fracIdx.forEach((i, k) => fracMap.set(i, fracOut[k] ?? ""))
  let out = ""
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (skip.has(i)) continue
    if (intMap.has(i)) out += intMap.get(i)
    else if (fracMap.has(i)) out += fracMap.get(i)
    else if (i === dec) out += (intIdx.length ? "" : intDigits) + decimalMark()
    else if (t.k === "general" || t.k === "at") out += ""
    else out += literalText(t)
  }
  return out
}

function renderScientific(x: number, toks: PTok[], expAt: number): string {
  const mant = toks.slice(0, expAt)
  const expTok = toks[expAt] as { k: "exp"; s: string; plus: boolean }
  let j = expAt + 1
  const expPh: ("0" | "#" | "?")[] = []
  while (j < toks.length && toks[j].k === "ph") { expPh.push((toks[j] as { k: "ph"; c: "0" | "#" | "?" }).c); j++ }
  const after = toks.slice(j)
  let d = -1
  for (let i = 0; i < mant.length; i++) if (mant[i].k === "dot") { d = i; break }
  const intCount = mant.filter((t, i) => t.k === "ph" && (d < 0 || i < d)).length
  const fracCount = d < 0 ? 0 : mant.filter((t, i) => t.k === "ph" && i > d).length
  let e = 0
  if (x !== 0) {
    e = Math.floor(Math.log10(x))
    if (intCount > 1) e = Math.floor(e / intCount) * intCount
    else if (intCount === 0) e += 1
  }
  let m = x / 10 ** e
  if (x !== 0 && intCount <= 1 && Number(fixedDigits(m, fracCount)) >= (intCount === 0 ? 1 : 10)) { e += 1; m = x / 10 ** e }
  const body = renderPlainNumber(m, mant)
  const sign = e < 0 ? "-" : expTok.plus ? "+" : ""
  const minDigits = expPh.filter((c) => c === "0").length
  const expDigits = String(Math.abs(e)).padStart(minDigits, "0")
  return `${body}${expTok.s}${sign}${expDigits}${after.map(literalText).join("")}`
}

/** Best n/d for f with d <= maxDen (smallest denominator among the closest). */
function approxFraction(f: number, maxDen: number): [number, number] {
  let best: [number, number] = [Math.round(f), 1]
  let err = Math.abs(f - best[0])
  for (let den = 2; den <= maxDen && err > 1e-12; den++) {
    const num = Math.round(f * den)
    const e = Math.abs(f - num / den)
    if (e < err - 1e-12) { best = [num, den]; err = e }
  }
  return best
}

function renderFraction(x: number, toks: PTok[], slashAt: number): string {
  let a = slashAt - 1
  while (a >= 0 && toks[a].k === "ph") a--
  const numIdx: number[] = []
  for (let i = a + 1; i < slashAt; i++) numIdx.push(i)
  let b = slashAt + 1
  const denIdx: number[] = []
  while (b < toks.length && (toks[b].k === "ph" || toks[b].k === "digit")) { denIdx.push(b); b++ }
  const denText = denIdx.map((i) => { const t = toks[i]; return t.k === "digit" ? t.s : (t as { c: string }).c }).join("")
  const fixedDen = /^[1-9]\d*$/.test(denText) ? Number(denText) : 0
  const intIdx = toks.flatMap((t, i) => (t.k === "ph" && i <= a ? [i] : []))
  let whole = intIdx.length ? Math.floor(x) : 0
  const f = x - whole
  let [nu, de] = fixedDen ? [Math.round(f * fixedDen), fixedDen] : approxFraction(f, 10 ** denIdx.length - 1)
  if (intIdx.length && nu === de && de > 0) { whole += 1; nu = 0 }
  const intFill = fillInt(whole ? String(whole) : "", phChars(toks, intIdx))
  const numFill = fillInt(String(nu), phChars(toks, numIdx))
  let denOut = String(de)
  if (!fixedDen) {
    const denPh = phChars(toks, denIdx)
    while (denOut.length < denPh.length) {
      const c = denPh[denOut.length]
      denOut += c === "?" ? " " : c === "0" ? "0" : ""
      if (c === "#") break
    }
  }
  // A whole number with nothing left over prints just the whole part (Sheets drops "0/1").
  const dropFraction = intIdx.length > 0 && nu === 0
  let out = ""
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const k = intIdx.indexOf(i)
    if (k >= 0) { out += intFill[k]; continue }
    if (i > a && i < b) {
      if (dropFraction) continue
      const nk = numIdx.indexOf(i)
      if (nk >= 0) out += numFill[nk]
      else if (i === slashAt) out += "/" + denOut
      continue
    }
    if (dropFraction && i > (intIdx[intIdx.length - 1] ?? -1) && i <= a) continue
    out += t.k === "general" || t.k === "at" ? "" : literalText(t)
  }
  if (dropFraction && !whole) out = out.replace(/^\s*$/, "0")
  return out
}

function renderNumberSection(x: number, sec: PSection): string {
  const toks = sec.toks
  const expAt = toks.findIndex((t) => t.k === "exp")
  if (expAt >= 0 && toks.slice(0, expAt).some((t) => t.k === "ph")) return renderScientific(x, toks, expAt)
  const slashAt = toks.findIndex((t, i) => t.k === "slash" && toks[i - 1]?.k === "ph" && (toks[i + 1]?.k === "ph" || toks[i + 1]?.k === "digit"))
  if (slashAt >= 0) return renderFraction(x, toks, slashAt)
  return renderPlainNumber(x, toks)
}

function renderDateSection(n: number, sec: PSection): string {
  const toks = sec.toks
  const elapsed = toks.some((t) => t.k === "elapsed")
  const neg = n < 0
  const v = Math.abs(n)
  // Fractional seconds: ".0", ".00", ".000" after the seconds.
  let fracDigits = 0
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].k !== "ph") continue
    let c = 0
    while (toks[i + c]?.k === "ph") c++
    fracDigits = Math.max(fracDigits, Math.min(c, 3))
    i += c
  }
  const unit = 10 ** fracDigits
  const totalUnits = Math.round(v * 86400 * unit)
  const totalSec = Math.floor(totalUnits / unit)
  const fracUnits = totalUnits - totalSec * unit
  const day = Math.floor(totalSec / 86400)
  const sod = totalSec - day * 86400
  const H = Math.floor(sod / 3600), M = Math.floor((sod % 3600) / 60), S = sod % 60
  const { y, m, d } = serialToYmd(day)
  const dow = weekdayOf(day)
  const ampm = toks.some((t) => t.k === "ampm")
  // "m"/"mm" are minutes right after an hour or right before a second; otherwise the month.
  const timeish = (t: PTok | undefined, unitCh: "h" | "s") =>
    t !== undefined && ((t.k === "date" && t.s[0] === unitCh) || (t.k === "elapsed" && t.u === unitCh))
  const sig = toks.map((t, i) => ({ t, i })).filter(({ t }) => t.k === "date" || t.k === "elapsed" || t.k === "ampm")
  const minuteAt = new Set<number>()
  sig.forEach(({ t, i }, k) => {
    if (t.k !== "date" || t.s[0] !== "m" || t.s.length > 2) return
    if (timeish(sig[k - 1]?.t, "h") || timeish(sig[k + 1]?.t, "s")) minuteAt.add(i)
  })
  let out = ""
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.k === "date") {
      const len = t.s.length
      switch (t.s[0]) {
        case "y": out += len <= 2 ? pad2(y % 100) : String(y); break
        case "d": out += len === 1 ? String(d) : len === 2 ? pad2(d) : weekdayName(dow, len >= 4); break
        case "h": {
          const h = ampm ? H % 12 || 12 : H
          out += len === 1 ? String(h) : pad2(h)
          break
        }
        case "s": out += len === 1 ? String(S) : pad2(S); break
        default: // m
          if (minuteAt.has(i)) out += len === 1 ? String(M) : pad2(M)
          else out += len === 1 ? String(m) : len === 2 ? pad2(m) : len === 3 ? monthName(m, false) : len === 4 ? monthName(m, true) : monthName(m, true).slice(0, 1)
      }
    } else if (t.k === "elapsed") {
      const total = t.u === "h" ? Math.floor(totalSec / 3600) : t.u === "m" ? Math.floor(totalSec / 60) : totalSec
      out += String(total).padStart(t.n, "0")
    } else if (t.k === "ampm") {
      const pm = H >= 12
      const word = t.s.length > 3 ? (pm ? "PM" : "AM") : pm ? "P" : "A"
      out += t.s[0] === t.s[0].toLowerCase() ? word.toLowerCase() : word
    } else if (t.k === "ph") {
      let c = 0
      while (toks[i + c]?.k === "ph") c++
      out += String(fracUnits).padStart(fracDigits, "0").slice(0, c)
      i += c - 1
    } else out += t.k === "at" || t.k === "general" ? "" : literalText(t)
  }
  return neg && (elapsed || out) ? `-${out}` : out
}

/**
 * A value under a Sheets custom number format, in the display locale. Text goes through the 4th
 * section (or a lone "@" section) and is otherwise shown as-is. Colours come back as "#rrggbb".
 */
export function formatNumberPattern(value: CellValue, pattern: string): PatternResult {
  if (value === null || value === "") return { text: "" }
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE" }
  const secs = patternSections(pattern)
  if (typeof value === "string") {
    const sec = secs[3] ?? (secs.length === 1 && secs[0].text ? secs[0] : null)
    if (!sec || isError(value)) return { text: value }
    return { text: sec.toks.map((t) => (t.k === "at" ? value : literalText(t))).join(""), color: sec.color }
  }
  if (!Number.isFinite(value)) return { text: ERR.num }
  const n = value
  let sec: PSection
  let signed = false
  const s0 = secs[0], s1 = secs[1], s2 = secs[2]
  if (s0.cond || s1?.cond) {
    if (s0.cond ? condHolds(s0.cond, n) : n > 0 || (n === 0 && !s2)) sec = s0
    else if (s1 && (!s1.cond || condHolds(s1.cond, n))) sec = s1
    else sec = s2 ?? s1 ?? s0
    signed = n < 0 && !(sec === s1 && !s1.cond)
  } else if (n > 0 || (n === 0 && !s2) || (n < 0 && !s1)) {
    sec = s0
    signed = n < 0
  } else if (n < 0) sec = s1 as PSection
  else sec = s2 as PSection
  if (sec.text) return { text: formatValue(n, null), color: sec.color }
  if (sec.date) return { text: renderDateSection(signed ? n : Math.abs(n), sec), color: sec.color }
  const body = renderNumberSection(Math.abs(n), sec)
  return { text: signed && /[1-9]/.test(body) ? `-${body}` : body, color: sec.color }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// A1 <-> index, A1 <-> stored
// ═════════════════════════════════════════════════════════════════════════════════════════════════

export function colLetter(index: number): string {
  let n = index
  let out = ""
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return out
}
export function letterToIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export type SheetShape = {
  /** Column ids in display order. */
  columnIds: string[]
  /** Row ids in display order. */
  rowIds: string[]
}

/** One A1 reference as the scanner sees it. Indices are 0-based; `row` is null for "A:A". */
export type A1Ref =
  | { kind: "cell"; col: number; row: number; absCol: boolean; absRow: boolean }
  | { kind: "col"; col: number; absCol: boolean }

const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/
const COL_RE = /^(\$?)([A-Za-z]{1,3})$/
const IDENT_CH = /[A-Za-z0-9_.$]/

/**
 * Walk an A1 formula and let `fn` rewrite every reference. String literals are skipped (so
 * =IF(A2="Q4";…) keeps "Q4"), function names are skipped (LOG10( is not a cell), and "A:B" is seen
 * as two whole-column references. Returning undefined keeps the original text.
 */
export function mapA1Refs(formula: string, fn: (ref: A1Ref, text: string, at: { start: number; end: number }) => string | undefined): string {
  let out = ""
  let i = 0
  const src = formula
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue } break }
        j += 1
      }
      out += src.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === "{") { // already-stored reference (mixed input): copy through
      const end = src.indexOf("}", i)
      if (end > 0) { out += src.slice(i, end + 1); i = end + 1; continue }
    }
    if (/[A-Za-z_$]/.test(ch) && !(i > 0 && /[A-Za-z0-9_]/.test(src[i - 1]))) {
      let j = i
      while (j < src.length && IDENT_CH.test(src[j])) j += 1
      const word = src.slice(i, j)
      let k = j
      while (k < src.length && src[k] === " ") k += 1
      const isCall = src[k] === "("
      const cell = isCall ? null : CELL_RE.exec(word)
      if (cell) {
        const ref: A1Ref = { kind: "cell", col: letterToIndex(cell[2]), row: Number(cell[4]) - 1, absCol: cell[1] === "$", absRow: cell[3] === "$" }
        out += fn(ref, word, { start: i, end: j }) ?? word
        i = j
        continue
      }
      // "A:B" — both sides bare letters
      const colA = isCall ? null : COL_RE.exec(word)
      if (colA && src[j] === ":") {
        let e = j + 1
        while (e < src.length && IDENT_CH.test(src[e])) e += 1
        const colB = COL_RE.exec(src.slice(j + 1, e))
        if (colB) {
          const a: A1Ref = { kind: "col", col: letterToIndex(colA[2]), absCol: colA[1] === "$" }
          const b: A1Ref = { kind: "col", col: letterToIndex(colB[2]), absCol: colB[1] === "$" }
          const bText = src.slice(j + 1, e)
          out += `${fn(a, word, { start: i, end: j }) ?? word}:${fn(b, bText, { start: j + 1, end: e }) ?? bText}`
          i = e
          continue
        }
      }
      out += word
      i = j
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** Every reference in an A1 formula as a rectangle (for the coloured outlines while typing). */
export function findA1Ranges(formula: string): { top: number; left: number; bottom: number; right: number; wholeColumn: boolean }[] {
  const refs: { ref: A1Ref; start: number; end: number }[] = []
  mapA1Refs(formula, (ref, _text, at) => { refs.push({ ref, start: at.start, end: at.end }); return undefined })
  const out: { top: number; left: number; bottom: number; right: number; wholeColumn: boolean }[] = []
  for (let i = 0; i < refs.length; i += 1) {
    const a = refs[i].ref
    const next = refs[i + 1]
    const joined = next && formula.slice(refs[i].end, next.start).trim() === ":"
    const b = joined ? next.ref : a
    if (joined) i += 1
    if (a.kind === "col" || b.kind === "col") {
      out.push({ top: 0, bottom: Number.MAX_SAFE_INTEGER, left: Math.min(a.col, b.col), right: Math.max(a.col, b.col), wholeColumn: true })
      continue
    }
    out.push({
      top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row),
      left: Math.min(a.col, b.col), right: Math.max(a.col, b.col), wholeColumn: false,
    })
  }
  return out
}

// ── Separators: stored neutral, shown Indonesian ─────────────────────────────────────────────────
//
// A formula is STORED in a neutral form — "," between arguments, "." as the decimal point — and SHOWN
// in the sheet's locale, Indonesian by default: ";" between arguments and "," as the decimal point,
// exactly like Google Sheets in id-ID. What people type is read generously: ";" always separates;
// "," separates too, except between two digits of a number, where it is the decimal point. A formula
// that uses "," BOTH ways without any ";" (=IF(A1>1,1,5)) can't be read safely, so it is kept as
// typed and shows #ERROR! with a hint, rather than silently meaning something else.

export type SheetLocale = "id" | "en"
const AMBIGUOUS = "=?"

/** Walk a formula outside string literals and {stored refs}, classifying "," ";" and number literals. */
function scanSeparators(src: string, visit: (kind: "semi" | "sep" | "decComma" | "decDot" | "other", i: number) => void): void {
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"') {
      let j = i + 1
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue } break } j += 1 }
      for (let k = i; k <= Math.min(j, src.length - 1); k += 1) visit("other", k)
      i = j + 1
      continue
    }
    if (ch === "{") {
      const end = src.indexOf("}", i)
      if (end > 0) { for (let k = i; k <= end; k += 1) visit("other", k); i = end + 1; continue }
    }
    if (/[A-Za-z_$]/.test(ch)) { // identifiers, functions, A1 refs (their digits are not numbers)
      let j = i
      while (j < src.length && /[A-Za-z0-9_.$]/.test(src[j])) j += 1
      for (let k = i; k < j; k += 1) visit("other", k)
      i = j
      continue
    }
    if (/[0-9]/.test(ch)) { // a number literal: "1,5" / "1.5" decimals
      let j = i
      let decimal = false
      while (j < src.length) {
        if (/[0-9]/.test(src[j])) { visit("other", j); j += 1; continue }
        if (!decimal && (src[j] === "," || src[j] === ".") && /[0-9]/.test(src[j + 1] ?? "")) {
          visit(src[j] === "," ? "decComma" : "decDot", j); decimal = true; j += 1; continue
        }
        break
      }
      i = j
      continue
    }
    visit(ch === ";" ? "semi" : ch === "," ? "sep" : "other", i)
    i += 1
  }
}

/** What people typed -> the neutral form, or null when its commas are ambiguous. */
export function canonicalFormula(a1: string): string | null {
  let semis = 0, seps = 0, decCommas = 0
  scanSeparators(a1, (k) => { if (k === "semi") semis++; else if (k === "sep") seps++; else if (k === "decComma") decCommas++ })
  if (!semis && seps && decCommas) return null
  let out = ""
  scanSeparators(a1, (k, i) => { out += k === "semi" ? "," : k === "decComma" ? "." : a1[i] })
  return out
}

/** The neutral form -> how a person in `locale` reads it (";" and decimal "," for Indonesian). */
export function localizeFormula(neutral: string, locale: SheetLocale = "id"): string {
  if (locale === "en") return neutral
  let out = ""
  scanSeparators(neutral, (k, i) => { out += k === "sep" || k === "semi" ? ";" : k === "decDot" ? "," : neutral[i] })
  return out
}

/** Bind A1 references to ids (no separator handling). */
function bindRefs(display: string, shape: SheetShape): string {
  return mapA1Refs(display, (ref) => {
    const col = shape.columnIds[ref.col]
    if (!col) return undefined
    if (ref.kind === "col") return `{${ref.absCol ? "$" : ""}${col}!*}`
    const row = shape.rowIds[ref.row]
    if (!row) return undefined
    return `{${ref.absCol ? "$" : ""}${col}!${ref.absRow ? "$" : ""}${row}}`
  })
}

/**
 * "=SUM(B2:B9;A1)" -> stored, neutral form with ids baked in. References pointing outside the sheet
 * stay as A1 text and evaluate to #REF! (binding them to whatever later lands in that slot would be
 * worse). A formula with ambiguous commas is stored as typed behind "=?" and evaluates to #ERROR!.
 */
export function toStored(display: string, shape: SheetShape): string {
  const neutral = canonicalFormula(display)
  if (neutral === null) return AMBIGUOUS + bindRefs(display.replace(/^=/, ""), shape)
  return bindRefs(neutral, shape)
}

const STORED = /\{(\$?)([^!}]+)!(\$?)([^}]+)\}/g

/** Stored form -> what the formula bar shows (Indonesian separators), using each id's CURRENT position. */
export function toDisplay(stored: string, shape: SheetShape, locale: SheetLocale = "id"): string {
  if (stored.startsWith(AMBIGUOUS)) return "=" + refsToA1(stored.slice(AMBIGUOUS.length), shape)
  return localizeFormula(refsToA1(stored, shape), locale)
}

function refsToA1(stored: string, shape: SheetShape): string {
  const colIdx = new Map(shape.columnIds.map((id, i) => [id, i]))
  const rowIdx = new Map(shape.rowIds.map((id, i) => [id, i]))
  return stored.replace(STORED, (_whole, ac: string, col: string, ar: string, row: string) => {
    const ci = colIdx.get(col)
    if (ci === undefined) return ERR.ref
    if (row === "*") return `${ac}${colLetter(ci)}`
    const ri = rowIdx.get(row)
    // The row it pointed at is gone — that IS a #REF!, and showing it is the honest thing.
    if (ri === undefined) return ERR.ref
    return `${ac}${colLetter(ci)}${ar}${ri + 1}`
  })
}

/**
 * Move a formula by (dRow, dCol), the way copy/paste and the fill handle do: relative parts shift,
 * "$" parts stay. A reference pushed off the top/left becomes #REF!, like Sheets.
 */
export function shiftFormula(a1: string, dRow: number, dCol: number): string {
  if (!dRow && !dCol) return a1
  return mapA1Refs(a1, (ref) => {
    const col = ref.absCol ? ref.col : ref.col + dCol
    if (col < 0) return ERR.ref
    if (ref.kind === "col") return `${ref.absCol ? "$" : ""}${colLetter(col)}`
    const row = ref.absRow ? ref.row : ref.row + dRow
    if (row < 0) return ERR.ref
    return `${ref.absCol ? "$" : ""}${colLetter(col)}${ref.absRow ? "$" : ""}${row + 1}`
  })
}

/**
 * Google Sheets / Excel R1C1 ("=R[0]C[-1]*2", "=SUM(R1C1:R[-1]C)") to A1 for the cell at
 * (row, col), 0-based. Used when a Sheets clipboard carries data-sheets-formula.
 */
export function r1c1ToA1(formula: string, row: number, col: number): string {
  let out = ""
  let i = 0
  while (i < formula.length) {
    const ch = formula[i]
    if (ch === '"') {
      let j = i + 1
      while (j < formula.length) { if (formula[j] === '"') { if (formula[j + 1] === '"') { j += 2; continue } break } j += 1 }
      out += formula.slice(i, j + 1)
      i = j + 1
      continue
    }
    const prev = i > 0 ? formula[i - 1] : ""
    if ((ch === "R" || ch === "r") && !/[A-Za-z0-9_]/.test(prev)) {
      const m = /^[Rr](\[-?\d+\]|\d+)?[Cc](\[-?\d+\]|\d+)?(?![A-Za-z0-9_(])/.exec(formula.slice(i))
      if (m) {
        const part = (spec: string | undefined, base: number): { v: number; abs: boolean } => {
          if (!spec) return { v: base, abs: false }
          if (spec.startsWith("[")) return { v: base + Number(spec.slice(1, -1)), abs: false }
          return { v: Number(spec) - 1, abs: true }
        }
        const r = part(m[1], row)
        const c = part(m[2], col)
        out += r.v < 0 || c.v < 0 ? ERR.ref : `${c.abs ? "$" : ""}${colLetter(c.v)}${r.abs ? "$" : ""}${r.v + 1}`
        i += m[0].length
        continue
      }
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * After rows/columns are deleted: shrink every range whose CORNER was deleted to the surviving
 * part, like Sheets (deleting row 2 of SUM(A2:A9) gives SUM(A2:A8), not #REF!). A range with nothing
 * left becomes #REF!. Single references to a deleted cell are left alone — they already show #REF!.
 * `shape` is the shape BEFORE the deletion. Returns the same string when nothing changed.
 */
export function rewriteForDeletion(stored: string, shape: SheetShape, deleted: { rows?: Set<string>; cols?: Set<string> }): string {
  const delRows = deleted.rows ?? new Set<string>()
  const delCols = deleted.cols ?? new Set<string>()
  if (!delRows.size && !delCols.size) return stored
  const colIdx = new Map(shape.columnIds.map((id, i) => [id, i]))
  const rowIdx = new Map(shape.rowIds.map((id, i) => [id, i]))
  const RANGE = /\{(\$?)([^!}]+)!(\$?)([^}]+)\}:\{(\$?)([^!}]+)!(\$?)([^}]+)\}/g
  return stored.replace(RANGE, (whole, ac1: string, c1: string, ar1: string, r1: string, ac2: string, c2: string, ar2: string, r2: string) => {
    const touched = delCols.has(c1) || delCols.has(c2) || (r1 !== "*" && delRows.has(r1)) || (r2 !== "*" && delRows.has(r2))
    if (!touched) return whole
    const ci1 = colIdx.get(c1), ci2 = colIdx.get(c2)
    if (ci1 === undefined || ci2 === undefined) return whole
    // Columns: walk inward from each corner to the nearest surviving column.
    const [cLo, cHi] = ci1 <= ci2 ? [ci1, ci2] : [ci2, ci1]
    let nl = cLo, nh = cHi
    while (nl <= cHi && delCols.has(shape.columnIds[nl])) nl += 1
    while (nh >= cLo && delCols.has(shape.columnIds[nh])) nh -= 1
    if (nl > nh) return ERR.ref
    const lo = { ac: ci1 <= ci2 ? ac1 : ac2, ar: ci1 <= ci2 ? ar1 : ar2 }
    const hi = { ac: ci1 <= ci2 ? ac2 : ac1, ar: ci1 <= ci2 ? ar2 : ar1 }
    const colLo = shape.columnIds[nl], colHi = shape.columnIds[nh]
    if (r1 === "*" || r2 === "*") return `{${lo.ac}${colLo}!*}:{${hi.ac}${colHi}!*}`
    const ri1 = rowIdx.get(r1), ri2 = rowIdx.get(r2)
    if (ri1 === undefined || ri2 === undefined) return whole
    const [rLo, rHi] = ri1 <= ri2 ? [ri1, ri2] : [ri2, ri1]
    const topAbs = ri1 <= ri2 ? ar1 : ar2
    const botAbs = ri1 <= ri2 ? ar2 : ar1
    let tl = rLo, th = rHi
    while (tl <= rHi && delRows.has(shape.rowIds[tl])) tl += 1
    while (th >= rLo && delRows.has(shape.rowIds[th])) th -= 1
    if (tl > th) return ERR.ref
    return `{${lo.ac}${colLo}!${topAbs}${shape.rowIds[tl]}}:{${hi.ac}${colHi}!${botAbs}${shape.rowIds[th]}}`
  })
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Tokenizer + parser
// ═════════════════════════════════════════════════════════════════════════════════════════════════

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: string }
  | { t: "ref"; col: string; row: string }
  | { t: "colref"; col: string }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "lp" } | { t: "rp" } | { t: "sep" } | { t: "colon" } | { t: "pct" }

/** True when the formula separates arguments with ";" (Indonesian Sheets) — then "1,5" is a number. */
function usesSemicolons(src: string): boolean {
  let inStr = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '"') inStr = !inStr
    else if (!inStr && ch === ";") return true
  }
  return false
}

function tokenize(src: string): Tok[] | ErrorValue {
  const out: Tok[] = []
  const semi = usesSemicolons(src)
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i += 1; continue }
    if (ch === "{") {
      const end = src.indexOf("}", i)
      if (end < 0) return ERR.value
      const inner = src.slice(i + 1, end)
      const bang = inner.indexOf("!")
      if (bang < 0) return ERR.value
      const col = inner.slice(0, bang).replace(/^\$/, "")
      const row = inner.slice(bang + 1).replace(/^\$/, "")
      out.push(row === "*" ? { t: "colref", col } : { t: "ref", col, row })
      i = end + 1
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let s = ""
      for (;;) {
        if (j >= src.length) return ERR.value
        if (src[j] === '"') {
          if (src[j + 1] === '"') { s += '"'; j += 2; continue }
          break
        }
        s += src[j]
        j += 1
      }
      out.push({ t: "str", v: s })
      i = j + 1
      continue
    }
    if (ch === "#") {
      const m = /^#(REF!|DIV\/0!|CIRCULAR!|CYCLE!|NAME\?|VALUE!|N\/A|NUM!|NULL!)/i.exec(src.slice(i))
      if (!m) return ERR.value
      out.push({ t: "err", v: m[0].toUpperCase() })
      i += m[0].length
      continue
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i
      let text = ""
      while (j < src.length) {
        const c = src[j]
        if (/[0-9]/.test(c)) { text += c; j += 1; continue }
        if (c === "." && !text.includes(".")) { text += "."; j += 1; continue }
        // "1,5" is a decimal only in ";" formulas — with "," separators it ends the argument.
        if (c === "," && semi && !text.includes(".") && /[0-9]/.test(src[j + 1] ?? "")) { text += "."; j += 1; continue }
        break
      }
      const exp = /^[eE][+-]?\d+/.exec(src.slice(j))
      if (exp) { text += exp[0]; j += exp[0].length }
      const n = Number(text)
      if (!Number.isFinite(n)) return ERR.value
      out.push({ t: "num", v: n })
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_.$]/.test(src[j])) j += 1
      const word = src.slice(i, j)
      const up = word.toUpperCase()
      let k = j
      while (k < src.length && src[k] === " ") k += 1
      if (src[k] !== "(" && (up === "TRUE" || up === "FALSE")) out.push({ t: "bool", v: up === "TRUE" })
      // An A1 address that toStored couldn't bind (outside the sheet) is a dead reference.
      else if (src[k] !== "(" && /^\$?[A-Za-z]{1,3}\$?\d+$/.test(word)) out.push({ t: "err", v: ERR.ref })
      else out.push({ t: "fn", v: up })
      i = j
      continue
    }
    if (ch === "(") { out.push({ t: "lp" }); i += 1; continue }
    if (ch === ")") { out.push({ t: "rp" }); i += 1; continue }
    if (ch === "," || ch === ";") { out.push({ t: "sep" }); i += 1; continue }
    if (ch === ":") { out.push({ t: "colon" }); i += 1; continue }
    if (ch === "%") { out.push({ t: "pct" }); i += 1; continue }
    if (src.startsWith(">=", i) || src.startsWith("<=", i) || src.startsWith("<>", i)) {
      out.push({ t: "op", v: src.slice(i, i + 2) }); i += 2; continue
    }
    if ("+-*/^<>=&".includes(ch)) { out.push({ t: "op", v: ch }); i += 1; continue }
    return ERR.value
  }
  return out
}

type RangeNode = { n: "range"; c1: string; c2: string; r1: string | null; r2: string | null }
type Node =
  | { n: "num"; v: number }
  | { n: "str"; v: string }
  | { n: "bool"; v: boolean }
  | { n: "err"; v: string }
  | { n: "ref"; col: string; row: string }
  | RangeNode
  | { n: "bin"; op: string; l: Node; r: Node }
  | { n: "neg"; e: Node }
  | { n: "pct"; e: Node }
  | { n: "call"; fn: string; args: Node[] }

const PREC: Record<string, number> = {
  "<": 1, ">": 1, "<=": 1, ">=": 1, "=": 1, "<>": 1,
  "&": 2,
  "+": 3, "-": 3,
  "*": 4, "/": 4,
  "^": 5,
}

function parse(toks: Tok[]): Node | ErrorValue {
  let p = 0
  const peek = () => toks[p]
  const eat = () => toks[p++]

  function primary(): Node | ErrorValue {
    const t = eat()
    if (!t) return ERR.value
    switch (t.t) {
      case "num": return { n: "num", v: t.v }
      case "str": return { n: "str", v: t.v }
      case "bool": return { n: "bool", v: t.v }
      case "err": return { n: "err", v: t.v }
      case "ref": {
        if (peek()?.t === "colon") {
          eat()
          const b = eat()
          if (!b || b.t !== "ref") return ERR.value
          return { n: "range", c1: t.col, r1: t.row, c2: b.col, r2: b.row }
        }
        return { n: "ref", col: t.col, row: t.row }
      }
      case "colref": {
        if (peek()?.t === "colon") {
          eat()
          const b = eat()
          if (!b || b.t !== "colref") return ERR.value
          return { n: "range", c1: t.col, r1: null, c2: b.col, r2: null }
        }
        return { n: "range", c1: t.col, r1: null, c2: t.col, r2: null }
      }
      case "lp": {
        const e = expr(0)
        if (isError(e)) return e
        if (eat()?.t !== "rp") return ERR.value
        return e
      }
      case "fn": {
        if (peek()?.t !== "lp") return ERR.name
        eat()
        const args: Node[] = []
        if (peek()?.t === "rp") { eat(); return { n: "call", fn: t.v, args } }
        for (;;) {
          // An empty argument (IF(A1;;0)) means "blank".
          if (peek()?.t === "sep" || peek()?.t === "rp") args.push({ n: "str", v: "" })
          else {
            const a = expr(0)
            if (isError(a)) return a
            args.push(a)
          }
          const nx = eat()
          if (!nx) return ERR.value
          if (nx.t === "rp") break
          if (nx.t !== "sep") return ERR.value
        }
        return { n: "call", fn: t.v, args }
      }
      default: return ERR.value
    }
  }

  function unary(): Node | ErrorValue {
    const t = peek()
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      eat()
      const e = unary()
      if (isError(e)) return e
      return t.v === "-" ? { n: "neg", e } : e
    }
    let e = primary()
    if (isError(e)) return e
    while (peek()?.t === "pct") { eat(); e = { n: "pct", e } }
    return e
  }

  function expr(min: number): Node | ErrorValue {
    let left = unary()
    if (isError(left)) return left
    for (;;) {
      const t = peek()
      if (!t || t.t !== "op") break
      const prec = PREC[t.v]
      if (prec === undefined || prec < min) break
      eat()
      const right = expr(prec + 1)
      if (isError(right)) return right
      left = { n: "bin", op: t.v, l: left, r: right }
    }
    return left
  }

  const node = expr(0)
  if (isError(node)) return node
  return p === toks.length ? node : ERR.value
}

const astCache = new Map<string, Node | ErrorValue>()
function compile(f: string): Node | ErrorValue {
  if (f.startsWith(AMBIGUOUS)) return ERR.error
  const hit = astCache.get(f)
  if (hit !== undefined) return hit
  const src = f.startsWith("=") ? f.slice(1) : f
  const toks = tokenize(src)
  const ast = isError(toks) ? toks : parse(toks)
  if (astCache.size > 5000) astCache.clear()
  astCache.set(f, ast)
  return ast
}

/** Does this stored formula parse? (The editor uses it to warn before saving.) */
export function formulaError(stored: string): ErrorValue | null {
  const ast = compile(stored)
  return isError(ast) ? ast : null
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Evaluation
// ═════════════════════════════════════════════════════════════════════════════════════════════════

export type SheetData = {
  shape: SheetShape
  /** rowId -> colId -> raw stored value (scalar, TypedCell, link, list or a formula cell). */
  cells: Map<string, Record<string, unknown>>
  /** colId -> column type. Optional; dates in date columns read as serials, and results take formats. */
  types?: Map<string, string>
  /** Named ranges (Data › Named ranges): NAME in upper case -> stored range "{c!r}:{c!r}". */
  names?: Map<string, string>
}

/**
 * Put named ranges into a stored formula: a bare word (not a function call, not inside a string or
 * an already-stored reference) that is a defined name becomes its stored range. The formula keeps
 * the name as typed; only evaluation sees the range, so renaming or moving the range just works.
 */
export function resolveNames(f: string, names: Map<string, string> | undefined): string {
  if (!names || !names.size) return f
  let out = ""
  let i = 0
  while (i < f.length) {
    const ch = f[i]
    if (ch === '"') {
      let j = i + 1
      while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { j += 2; continue } break } j += 1 }
      out += f.slice(i, j + 1); i = j + 1; continue
    }
    if (ch === "{") { const end = f.indexOf("}", i); if (end > 0) { out += f.slice(i, end + 1); i = end + 1; continue } }
    if (/[A-Za-z_]/.test(ch) && !(i > 0 && /[A-Za-z0-9_.$]/.test(f[i - 1]))) {
      let j = i
      while (j < f.length && /[A-Za-z0-9_.]/.test(f[j])) j += 1
      const word = f.slice(i, j)
      let k = j
      while (k < f.length && f[k] === " ") k += 1
      const range = f[k] === "(" || f[k] === "!" ? undefined : names.get(word.toUpperCase())
      out += range ?? word
      i = j
      continue
    }
    out += ch
    i += 1
  }
  return out
}

type Matrix = CellValue[][]

const KEY_SEP = "\u0001"
function sameTypes(a: Map<string, string> | undefined, b: Map<string, string> | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}
const keyOf = (rowId: string, colId: string) => `${rowId}${KEY_SEP}${colId}`

const truthy = (v: CellValue): boolean | ErrorValue => {
  if (isError(v)) return v
  if (typeof v === "boolean") return v
  if (v === null || v === "") return false
  if (typeof v === "number") return v !== 0
  const s = v.trim().toUpperCase()
  if (s === "TRUE") return true
  if (s === "FALSE") return false
  const n = numberFromText(v)
  return n === null ? ERR.value : n !== 0
}

/** A scalar as a number, for arithmetic: blank is 0, text must be clearly numeric. */
function toNum(v: CellValue): number | ErrorValue {
  if (v === null || v === "") return 0
  if (typeof v === "number") return v
  if (typeof v === "boolean") return v ? 1 : 0
  if (isError(v)) return v
  const n = numberFromText(v)
  return n === null ? ERR.value : n
}
const toText = (v: CellValue): string =>
  v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(Number(v.toPrecision(15))) : v

/** Excel ordering: numbers < text < booleans; text compares case-insensitively. */
function compare(a: CellValue, b: CellValue): number {
  const rank = (v: CellValue) => (typeof v === "boolean" ? 2 : typeof v === "string" && v !== "" ? 1 : 0)
  let x: CellValue = a
  let y: CellValue = b
  // Numeric text (legacy text columns hold "1500000") compares as a number against a number.
  if (typeof x === "string" && typeof y === "number") { const n = numberFromText(x); if (n !== null) x = n }
  if (typeof y === "string" && typeof x === "number") { const n = numberFromText(y); if (n !== null) y = n }
  if (x === null) x = typeof y === "string" ? "" : typeof y === "boolean" ? false : 0
  if (y === null) y = typeof x === "string" ? "" : typeof x === "boolean" ? false : 0
  const rx = rank(x), ry = rank(y)
  if (rx !== ry) return rx - ry
  if (typeof x === "number" && typeof y === "number") return x === y ? 0 : x < y ? -1 : 1
  if (typeof x === "boolean" && typeof y === "boolean") return Number(x) - Number(y)
  return String(x).toLowerCase().localeCompare(String(y).toLowerCase(), "id")
}

function wildcardRegex(pattern: string): RegExp {
  let re = ""
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]
    if (c === "~" && i + 1 < pattern.length) { re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); i += 1 }
    else if (c === "*") re += ".*"
    else if (c === "?") re += "."
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${re}$`, "i")
}

/**
 * Excel-style criteria: ">100", "<=5", "<>abc", "a*", a number, or a bare value meaning equals.
 * Shared by every *IF/*IFS function so they can't drift apart.
 */
function matchesCriteria(value: CellValue, criteria: CellValue): boolean {
  if (isError(value)) return false
  if (typeof criteria === "number" || typeof criteria === "boolean") {
    if (value === null || value === "") return false
    return compare(value, criteria) === 0
  }
  const crit = String(criteria ?? "")
  const m = /^(>=|<=|<>|>|<|=)?([\s\S]*)$/.exec(crit)
  const op = m?.[1] ?? ""
  const target = m?.[2] ?? ""
  const blank = value === null || value === ""
  if (target === "") {
    if (op === "<>") return !blank
    return blank // "" or "=" matches empty cells
  }
  if (blank) return op === "<>"
  const tNum = numberFromText(target)
  const vNum = typeof value === "number" ? value : typeof value === "string" ? numberFromText(value) : null
  if (tNum !== null && vNum !== null) {
    switch (op) {
      case ">": return vNum > tNum
      case "<": return vNum < tNum
      case ">=": return vNum >= tNum
      case "<=": return vNum <= tNum
      case "<>": return vNum !== tNum
      default: return vNum === tNum
    }
  }
  const sv = toText(value)
  if (op === "" || op === "=" || op === "<>") {
    const hit = /[*?]/.test(target) ? wildcardRegex(target).test(sv) : sv.toLowerCase() === target.toLowerCase()
    return op === "<>" ? !hit : hit
  }
  const cmp = sv.toLowerCase().localeCompare(target.toLowerCase(), "id")
  switch (op) {
    case ">": return cmp > 0
    case "<": return cmp < 0
    case ">=": return cmp >= 0
    default: return cmp <= 0
  }
}

// ── Functions delegated to formulajs ────────────────────────────────────────────────────────────

type FjsFn = (...args: unknown[]) => unknown
/** Excel name -> formulajs function. An allow-list, so the autocomplete never offers what can't run. */
const FORMULAJS: Record<string, FjsFn> = {
  INDEX: INDEX as FjsFn, MATCH: MATCH as FjsFn, SUMPRODUCT: SUMPRODUCT as FjsFn,
  EOMONTH: EOMONTH as FjsFn, EDATE: EDATE as FjsFn, NETWORKDAYS: NETWORKDAYS as FjsFn,
  "NETWORKDAYS.INTL": NETWORKDAYSINTL as FjsFn, WORKDAY: WORKDAY as FjsFn, "WORKDAY.INTL": WORKDAYINTL as FjsFn,
  WEEKDAY: WEEKDAY as FjsFn, WEEKNUM: WEEKNUM as FjsFn, ISOWEEKNUM: ISOWEEKNUM as FjsFn, YEARFRAC: YEARFRAC as FjsFn,
  DAYS: DAYS as FjsFn, DAYS360: DAYS360 as FjsFn,
  CHOOSE: CHOOSE as FjsFn, SWITCH: SWITCH as FjsFn, XOR: XOR as FjsFn,
  PROPER: PROPER as FjsFn, REPT: REPT as FjsFn, EXACT: EXACT as FjsFn, SEARCH: SEARCH as FjsFn,
  REPLACE: REPLACE as FjsFn, TEXTJOIN: TEXTJOIN as FjsFn, CHAR: CHAR as FjsFn, CODE: CODE as FjsFn, CLEAN: CLEAN as FjsFn,
  CEILING: CEILING as FjsFn, FLOOR: FLOOR as FjsFn, MROUND: MROUND as FjsFn, TRUNC: TRUNC as FjsFn, SIGN: SIGN as FjsFn,
  PI: PI as FjsFn, EXP: EXP as FjsFn, LN: LN as FjsFn, LOG: LOG as FjsFn, LOG10: LOG10 as FjsFn,
  RAND: RAND as FjsFn, RANDBETWEEN: RANDBETWEEN as FjsFn, ISEVEN: ISEVEN as FjsFn, ISODD: ISODD as FjsFn,
  STDEV: STDEVS as FjsFn, "STDEV.S": STDEVS as FjsFn, STDEVP: STDEVP as FjsFn, "STDEV.P": STDEVP as FjsFn,
  VAR: VARS as FjsFn, "VAR.S": VARS as FjsFn, VARP: VARP as FjsFn, "VAR.P": VARP as FjsFn,
  LARGE: LARGE as FjsFn, SMALL: SMALL as FjsFn, RANK: RANKEQ as FjsFn, "RANK.EQ": RANKEQ as FjsFn,
  PERCENTILE: PERCENTILEINC as FjsFn, "PERCENTILE.INC": PERCENTILEINC as FjsFn,
  QUARTILE: QUARTILEINC as FjsFn, "QUARTILE.INC": QUARTILEINC as FjsFn, MODE: MODESNGL as FjsFn,
  PMT: PMT as FjsFn, FV: FV as FjsFn, PV: PV as FjsFn, NPV: NPV as FjsFn, IRR: IRR as FjsFn,
  RATE: RATE as FjsFn, NPER: NPER as FjsFn, IPMT: IPMT as FjsFn, PPMT: PPMT as FjsFn,
}
/** Which argument positions are dates, per formulajs function: passed as local Date objects. */
const DATE_ARGS: Record<string, number[]> = {
  EOMONTH: [0], EDATE: [0], NETWORKDAYS: [0, 1, 2], "NETWORKDAYS.INTL": [0, 1, 3], WORKDAY: [0, 2],
  "WORKDAY.INTL": [0, 3], WEEKDAY: [0], WEEKNUM: [0], ISOWEEKNUM: [0], YEARFRAC: [0, 1], DAYS: [0, 1], DAYS360: [0, 1],
}
/** Functions whose result is a date (so it displays as one). */
const DATE_RESULT = new Set(["TODAY", "NOW", "DATE", "DATEVALUE", "EOMONTH", "EDATE", "WORKDAY", "WORKDAY.INTL"])
/** Functions whose result has the format of their first argument. */
const FORMAT_OF_FIRST = new Set(["SUM", "MIN", "MAX", "AVERAGE", "AVG", "MEDIAN", "ROUND", "ROUNDUP", "ROUNDDOWN", "ABS",
  "INT", "CEILING", "FLOOR", "MROUND", "TRUNC", "LARGE", "SMALL", "MODE", "AVERAGEIF", "AVERAGEIFS", "MAXIFS", "MINIFS", "SUMIFS"])

const serialToLocalDate = (s: number): Date => {
  const { y, m, d } = serialToYmd(s)
  const frac = s - Math.floor(s)
  return new Date(y, m - 1, d, 0, 0, Math.round(frac * 86_400))
}
const localDateToSerial = (d: Date): number => {
  const base = ymdToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate())
  const secs = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
  return secs ? base + secs / 86_400 : base
}

/**
 * Evaluates one sheet. One instance per SheetData object: every cell value is computed at most once
 * (cache), and the reads made while computing a formula are recorded (dependency graph), so
 * `derive(next)` can carry over every cached value an edit didn't touch.
 */
export class SheetEngine {
  data: SheetData
  colIndex: Map<string, number>
  rowIndex: Map<string, number>
  values = new Map<string, CellValue>()
  formats = new Map<string, NumFmt | null>()
  /** cell key -> formula cells that read it */
  dependents = new Map<string, Set<string>>()
  stack: string[] = []
  stackRows: string[] = []
  inCycle = new Set<string>()
  fmtVisiting = new Set<string>()

  constructor(data: SheetData) {
    this.data = data
    this.colIndex = new Map(data.shape.columnIds.map((id, i) => [id, i]))
    this.rowIndex = new Map(data.shape.rowIds.map((id, i) => [id, i]))
  }

  /**
   * A new engine for `next`, reusing every cached value that cannot have changed. Shapes must match
   * (any row/column added, removed or moved = start fresh: positions feed ranges).
   */
  derive(next: SheetData): SheetEngine {
    const fresh = new SheetEngine(next)
    const a = this.data.shape, b = next.shape
    const sameShape = a.columnIds.length === b.columnIds.length && a.rowIds.length === b.rowIds.length &&
      a.columnIds.every((c, i) => c === b.columnIds[i]) && a.rowIds.every((r, i) => r === b.rowIds[i]) &&
      sameTypes(this.data.types, next.types) && sameTypes(this.data.names, next.names)
    if (!sameShape) return fresh
    const changed: string[] = []
    for (const rowId of b.rowIds) {
      const before = this.data.cells.get(rowId)
      const after = next.cells.get(rowId)
      if (before === after) continue
      const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
      for (const k of keys) {
        const x = before?.[k], y = after?.[k]
        if (x === y) continue
        if (x && y && typeof x === "object" && typeof y === "object" && JSON.stringify(x) === JSON.stringify(y)) continue
        changed.push(keyOf(rowId, k))
      }
    }
    // Everything reachable from a changed cell through the dependents graph is stale.
    const stale = new Set<string>()
    const queue = [...changed]
    while (queue.length) {
      const k = queue.pop() as string
      if (stale.has(k)) continue
      stale.add(k)
      for (const d of this.dependents.get(k) ?? []) queue.push(d)
    }
    // Volatile results (TODAY, NOW, RAND) are never carried over.
    for (const [k, v] of this.values) if (!stale.has(k) && !this.volatile.has(k)) fresh.values.set(k, v)
    for (const [k, v] of this.formats) if (!stale.has(k)) fresh.formats.set(k, v)
    for (const [k, deps] of this.dependents) {
      if (stale.has(k)) continue
      const kept = [...deps].filter((d) => !stale.has(d))
      if (kept.length) fresh.dependents.set(k, new Set(kept))
    }
    return fresh
  }

  volatile = new Set<string>()

  /** Raw stored value -> engine scalar (typed numbers, link labels, dates in date columns as serials). */
  scalar(raw: unknown, colId: string): CellValue {
    if (raw === undefined || raw === null) return null
    if (isTypedCell(raw)) return raw.v
    if (Array.isArray(raw)) return raw.join(", ")
    if (isLinkLike(raw)) return raw.t || raw.u
    if (typeof raw === "object") return null
    if (typeof raw === "string" && this.data.types?.get(colId) === "date") {
      const s = isoToSerial(raw) ?? parseDateText(raw)
      return s === null ? raw : s
    }
    return raw as CellValue
  }

  /** The value of one cell (a formula's result, or the stored value). */
  value(rowId: string, colId: string): CellValue {
    const raw = this.data.cells.get(rowId)?.[colId]
    if (!isFormulaCell(raw)) return this.scalar(raw, colId)
    const key = keyOf(rowId, colId)
    const cached = this.values.get(key)
    if (cached !== undefined) return cached
    const at = this.stack.indexOf(key)
    if (at >= 0) {
      // Re-entering a cell that is still being computed: everything on the loop is circular.
      for (let i = at; i < this.stack.length; i += 1) this.inCycle.add(this.stack[i])
      return ERR.cycle
    }
    this.stack.push(key)
    this.stackRows.push(rowId)
    let v: CellValue
    try {
      const ast = compile(resolveNames(raw.f, this.data.names))
      v = isError(ast) ? ast : this.evalScalar(ast)
      if (typeof v === "number" && !Number.isFinite(v)) v = ERR.num
    } catch {
      v = ERR.value
    } finally {
      this.stack.pop()
      this.stackRows.pop()
    }
    if (this.inCycle.has(key)) v = ERR.cycle
    this.values.set(key, v)
    return v
  }

  /** The display format of a cell's value (TypedCell's format, column type, or a formula's inferred one). */
  format(rowId: string, colId: string): NumFmt | null {
    const raw = this.data.cells.get(rowId)?.[colId]
    if (isTypedCell(raw)) return raw.nf
    if (!isFormulaCell(raw)) {
      const type = this.data.types?.get(colId)
      if (type === "currency") return "idr"
      if (type === "date") return "date"
      if (typeof raw === "string" && isoToSerial(raw) !== null) return "date"
      return null
    }
    const key = keyOf(rowId, colId)
    if (this.formats.has(key)) return this.formats.get(key) ?? null
    if (this.fmtVisiting.has(key)) return null
    this.fmtVisiting.add(key)
    let nf: NumFmt | null = null
    try {
      const ast = compile(resolveNames(raw.f, this.data.names))
      nf = isError(ast) ? null : this.formatOf(ast)
    } finally {
      this.fmtVisiting.delete(key)
    }
    this.formats.set(key, nf)
    return nf
  }

  /**
   * Evaluate a stored formula that lives in no cell (data validation's "custom formula is"), as if
   * it were in row `rowId` (for implicit intersection). Reads made here are not recorded as deps.
   */
  evaluateFormula(stored: string, rowId: string | null = null): CellValue {
    const ast = compile(resolveNames(stored.startsWith("=") ? stored : `=${stored}`, this.data.names))
    if (isError(ast)) return ast
    this.stackRows.push(rowId ?? "")
    try {
      const v = this.evalScalar(ast)
      return typeof v === "number" && !Number.isFinite(v) ? ERR.num : v
    } catch {
      return ERR.value
    } finally {
      this.stackRows.pop()
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  read(rowId: string, colId: string): CellValue {
    const top = this.stack[this.stack.length - 1]
    if (top) {
      const k = keyOf(rowId, colId)
      let set = this.dependents.get(k)
      if (!set) { set = new Set(); this.dependents.set(k, set) }
      set.add(top)
    }
    return this.value(rowId, colId)
  }

  /** Row ids and column ids a range covers, in display order; null when a corner is gone. */
  rangeIds(node: RangeNode): { rows: string[]; cols: string[] } | null {
    const c1 = this.colIndex.get(node.c1), c2 = this.colIndex.get(node.c2)
    if (c1 === undefined || c2 === undefined) return null
    const cols = this.data.shape.columnIds.slice(Math.min(c1, c2), Math.max(c1, c2) + 1)
    if (node.r1 === null || node.r2 === null) return { rows: this.data.shape.rowIds, cols }
    const r1 = this.rowIndex.get(node.r1), r2 = this.rowIndex.get(node.r2)
    if (r1 === undefined || r2 === undefined) return null
    return { rows: this.data.shape.rowIds.slice(Math.min(r1, r2), Math.max(r1, r2) + 1), cols }
  }

  matrix(node: Node): Matrix | ErrorValue {
    if (node.n === "range") {
      const ids = this.rangeIds(node)
      if (!ids) return ERR.ref
      return ids.rows.map((r) => ids.cols.map((c) => this.read(r, c)))
    }
    const v = this.evalScalar(node)
    return [[v]]
  }

  /** Every value an argument contributes (ranges flattened row by row). */
  flat(node: Node): CellValue[] | ErrorValue {
    const m = this.matrix(node)
    return isError(m) ? m : m.flat()
  }

  evalScalar(node: Node): CellValue {
    switch (node.n) {
      case "num": return node.v
      case "str": return node.v
      case "bool": return node.v
      case "err": return node.v
      case "ref": {
        if (!this.colIndex.has(node.col) || !this.rowIndex.has(node.row)) return ERR.ref
        return this.read(node.row, node.col)
      }
      case "range": {
        // A range where one value is expected: Excel's implicit intersection — the cell in THIS
        // formula's row for a one-column range, otherwise the first cell.
        const ids = this.rangeIds(node)
        if (!ids) return ERR.ref
        const here = this.stackRows[this.stackRows.length - 1]
        if (ids.cols.length === 1 && here && ids.rows.includes(here)) return this.read(here, ids.cols[0])
        return ids.rows.length && ids.cols.length ? this.read(ids.rows[0], ids.cols[0]) : null
      }
      case "neg": {
        const v = toNum(this.evalScalar(node.e))
        return isError(v) ? v : -v
      }
      case "pct": {
        const v = toNum(this.evalScalar(node.e))
        return isError(v) ? v : v / 100
      }
      case "bin": {
        const l = this.evalScalar(node.l)
        if (isError(l)) return l
        const r = this.evalScalar(node.r)
        if (isError(r)) return r
        if (node.op === "&") return toText(l) + toText(r)
        if (PREC[node.op] === 1) {
          const c = compare(l, r)
          switch (node.op) {
            case ">": return c > 0
            case "<": return c < 0
            case ">=": return c >= 0
            case "<=": return c <= 0
            case "=": return c === 0
            default: return c !== 0
          }
        }
        const a = toNum(l); if (isError(a)) return a
        const b = toNum(r); if (isError(b)) return b
        switch (node.op) {
          case "+": return a + b
          case "-": return a - b
          case "*": return a * b
          case "/": return b === 0 ? ERR.div : a / b
          case "^": {
            const p = a ** b
            return Number.isFinite(p) ? p : ERR.num
          }
          default: return ERR.value
        }
      }
      case "call": return this.call(node.fn, node.args)
    }
  }

  /** Numbers for SUM-like functions: ranges skip blanks/text/booleans, direct arguments must be numeric. */
  numbers(args: Node[]): number[] | ErrorValue {
    const out: number[] = []
    for (const arg of args) {
      if (arg.n === "range") {
        const vals = this.flat(arg)
        if (isError(vals)) return vals
        for (const v of vals) {
          if (isError(v)) return v
          if (typeof v === "number") out.push(v)
          else if (typeof v === "string" && v !== "") {
            // Legacy text columns hold "1.500.000" as text; count it like the number it plainly is.
            const n = numberFromText(v)
            if (n !== null) out.push(n)
          }
        }
        continue
      }
      const v = this.evalScalar(arg)
      if (isError(v)) return v
      if (v === null || v === "") continue
      const n = toNum(v)
      if (isError(n)) return n
      out.push(n)
    }
    return out
  }

  scalarArgs(args: Node[]): CellValue[] | ErrorValue {
    const out: CellValue[] = []
    for (const a of args) {
      const v = this.evalScalar(a)
      if (isError(v)) return v
      out.push(v)
    }
    return out
  }

  /** Conditional aggregate core shared by *IF and *IFS: indices that pass every (range, criteria). */
  matchingIndices(pairs: { range: Node; crit: Node }[]): { idx: number[]; length: number } | ErrorValue {
    let length = -1
    let keep: boolean[] = []
    for (const { range, crit } of pairs) {
      const vals = this.flat(range)
      if (isError(vals)) return vals
      const c = this.evalScalar(crit)
      if (isError(c)) return c
      if (length < 0) { length = vals.length; keep = new Array(length).fill(true) }
      for (let i = 0; i < length; i += 1) if (keep[i] && !matchesCriteria(vals[i] ?? null, c)) keep[i] = false
    }
    const idx: number[] = []
    keep.forEach((k, i) => { if (k) idx.push(i) })
    return { idx, length: Math.max(0, length) }
  }

  call(fn: string, args: Node[]): CellValue {
    const nums = () => this.numbers(args)
    const sargs = () => this.scalarArgs(args)
    const num1 = (i: number, dflt?: number): number | ErrorValue => {
      if (!args[i]) return dflt ?? ERR.value
      return toNum(this.evalScalar(args[i]))
    }
    const str1 = (i: number): string | ErrorValue => {
      if (!args[i]) return ""
      const v = this.evalScalar(args[i])
      return isError(v) ? v : toText(v)
    }
    switch (fn) {
      case "SUM": { const n = nums(); return isError(n) ? n : n.reduce((s, x) => s + x, 0) }
      case "AVERAGE":
      case "AVG": { const n = nums(); if (isError(n)) return n; return n.length ? n.reduce((s, x) => s + x, 0) / n.length : ERR.div }
      case "MIN": { const n = nums(); if (isError(n)) return n; return n.length ? Math.min(...n) : 0 }
      case "MAX": { const n = nums(); if (isError(n)) return n; return n.length ? Math.max(...n) : 0 }
      case "COUNT": { const n = nums(); return isError(n) ? n : n.length }
      case "COUNTA": {
        let c = 0
        for (const a of args) { const v = this.flat(a); if (isError(v)) { c += 1; continue } c += v.filter((x) => x !== null && x !== "").length }
        return c
      }
      case "COUNTBLANK": {
        let c = 0
        for (const a of args) { const v = this.flat(a); if (isError(v)) return v; c += v.filter((x) => x === null || x === "").length }
        return c
      }
      case "PRODUCT": { const n = nums(); return isError(n) ? n : n.reduce((s, x) => s * x, 1) }
      case "MEDIAN": {
        const n = nums(); if (isError(n)) return n
        if (!n.length) return ERR.num
        const sorted = [...n].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
      }
      case "ROUND":
      case "ROUNDUP":
      case "ROUNDDOWN": {
        const a = num1(0); if (isError(a)) return a
        const d = num1(1, 0); if (isError(d)) return d
        const f = 10 ** Math.trunc(d)
        const x = Number((Math.abs(a) * f).toPrecision(15))
        const r = fn === "ROUND" ? Math.round(x) : fn === "ROUNDUP" ? Math.ceil(x) : Math.floor(x)
        return Math.sign(a) * r / f
      }
      case "ABS": { const a = num1(0); return isError(a) ? a : Math.abs(a) }
      case "INT": { const a = num1(0); return isError(a) ? a : Math.floor(a) }
      case "MOD": {
        const a = num1(0); if (isError(a)) return a
        const b = num1(1); if (isError(b)) return b
        if (b === 0) return ERR.div
        return a - b * Math.floor(a / b)
      }
      case "SQRT": { const a = num1(0); if (isError(a)) return a; return a < 0 ? ERR.num : Math.sqrt(a) }
      case "POWER": {
        const a = num1(0); if (isError(a)) return a
        const b = num1(1); if (isError(b)) return b
        const p = a ** b
        return Number.isFinite(p) ? p : ERR.num
      }
      // ── Logic ───────────────────────────────────────────────────────────
      case "IF": {
        if (args.length < 2) return ERR.value
        const cond = truthy(this.evalScalar(args[0]))
        if (isError(cond)) return cond
        const branch = cond ? args[1] : args[2]
        return branch ? this.evalScalar(branch) : false
      }
      case "IFS": {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const c = truthy(this.evalScalar(args[i]))
          if (isError(c)) return c
          if (c) return this.evalScalar(args[i + 1])
        }
        return ERR.na
      }
      case "IFERROR": {
        const v = args[0] ? this.evalScalar(args[0]) : null
        if (!isError(v)) return v
        return args[1] ? this.evalScalar(args[1]) : ""
      }
      case "IFNA": {
        const v = args[0] ? this.evalScalar(args[0]) : null
        if (v !== ERR.na) return v
        return args[1] ? this.evalScalar(args[1]) : ""
      }
      case "AND":
      case "OR": {
        const vals: boolean[] = []
        for (const a of args) {
          const v = a.n === "range" ? this.flat(a) : [this.evalScalar(a)]
          if (isError(v)) return v
          for (const x of v) {
            if (a.n === "range" && (x === null || typeof x === "string")) continue
            const t = truthy(x)
            if (isError(t)) return t
            vals.push(t)
          }
        }
        if (!vals.length) return ERR.value
        return fn === "AND" ? vals.every(Boolean) : vals.some(Boolean)
      }
      case "NOT": { const t = truthy(args[0] ? this.evalScalar(args[0]) : null); return isError(t) ? t : !t }
      case "TRUE": return true
      case "FALSE": return false
      case "ISBLANK": { const v = args[0] ? this.evalScalar(args[0]) : null; return v === null || v === "" }
      case "ISNUMBER": { const v = args[0] ? this.evalScalar(args[0]) : null; return typeof v === "number" }
      case "ISTEXT": { const v = args[0] ? this.evalScalar(args[0]) : null; return typeof v === "string" && !isError(v) }
      case "ISERROR": { const v = args[0] ? this.evalScalar(args[0]) : null; return isError(v) }
      case "ISNA": { const v = args[0] ? this.evalScalar(args[0]) : null; return v === ERR.na }
      // ── Text ────────────────────────────────────────────────────────────
      case "CONCAT":
      case "CONCATENATE": {
        let s = ""
        for (const a of args) { const v = this.flat(a); if (isError(v)) return v; for (const x of v) { if (isError(x)) return x; s += toText(x) } }
        return s
      }
      case "LEN": { const s = str1(0); return isError(s) ? s : s.length }
      case "UPPER": { const s = str1(0); return isError(s) ? s : s.toUpperCase() }
      case "LOWER": { const s = str1(0); return isError(s) ? s : s.toLowerCase() }
      case "TRIM": { const s = str1(0); return isError(s) ? s : s.trim().replace(/\s+/g, " ") }
      case "LEFT":
      case "RIGHT": {
        const s = str1(0); if (isError(s)) return s
        const n = num1(1, 1); if (isError(n)) return n
        if (n < 0) return ERR.value
        const k = Math.trunc(n)
        return fn === "LEFT" ? s.slice(0, k) : k === 0 ? "" : s.slice(-k)
      }
      case "MID": {
        const s = str1(0); if (isError(s)) return s
        const start = num1(1); if (isError(start)) return start
        const len = num1(2); if (isError(len)) return len
        if (start < 1 || len < 0) return ERR.value
        const from = Math.trunc(start) - 1
        return s.slice(from, from + Math.trunc(len))
      }
      case "FIND": {
        const needle = str1(0); if (isError(needle)) return needle
        const hay = str1(1); if (isError(hay)) return hay
        const from = num1(2, 1); if (isError(from)) return from
        const at = hay.indexOf(needle, Math.max(0, Math.trunc(from) - 1))
        return at < 0 ? ERR.value : at + 1
      }
      case "SUBSTITUTE": {
        const s = str1(0); if (isError(s)) return s
        const from = str1(1); if (isError(from)) return from
        const to = str1(2); if (isError(to)) return to
        if (!from) return s
        if (args[3]) {
          const nth = num1(3); if (isError(nth)) return nth
          let count = 0
          return s.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (m) => (++count === Math.trunc(nth) ? to : m))
        }
        return s.split(from).join(to)
      }
      case "TEXT": {
        const v = args[0] ? this.evalScalar(args[0]) : null
        if (isError(v)) return v
        const f = str1(1); if (isError(f)) return f
        return textFormat(v, f)
      }
      case "VALUE": {
        const v = args[0] ? this.evalScalar(args[0]) : null
        if (isError(v)) return v
        if (typeof v === "number") return v
        if (v === null || v === "") return 0
        const n = numberFromText(String(v))
        return n === null ? ERR.value : n
      }
      // ── Dates (serials; Asia/Jakarta) ───────────────────────────────────
      case "TODAY": this.markVolatile(); return todaySerial()
      case "NOW": this.markVolatile(); return nowSerial()
      case "DATE": {
        const y = num1(0); if (isError(y)) return y
        const m = num1(1); if (isError(m)) return m
        const d = num1(2); if (isError(d)) return d
        const s = ymdToSerial(Math.trunc(y), Math.trunc(m), Math.trunc(d))
        return s < 0 ? ERR.num : s
      }
      case "DATEVALUE": {
        const s = str1(0); if (isError(s)) return s
        const v = parseDateText(s)
        return v === null ? ERR.value : v
      }
      case "YEAR":
      case "MONTH":
      case "DAY": {
        const s = num1(0); if (isError(s)) return s
        if (s < 0) return ERR.num
        const { y, m, d } = serialToYmd(s)
        return fn === "YEAR" ? y : fn === "MONTH" ? m : d
      }
      case "DATEDIF": {
        const a = num1(0); if (isError(a)) return a
        const b = num1(1); if (isError(b)) return b
        if (b < a) return ERR.num
        const unit = (() => { const u = str1(2); return isError(u) ? "D" : (u || "D").toUpperCase() })()
        if (unit === "D") return Math.floor(b) - Math.floor(a)
        const A = serialToYmd(a), B = serialToYmd(b)
        let months = (B.y - A.y) * 12 + (B.m - A.m)
        if (B.d < A.d) months -= 1
        if (unit === "M") return months
        if (unit === "Y") return Math.trunc(months / 12)
        if (unit === "YM") return months % 12
        if (unit === "MD") { const prev = B.d >= A.d ? B.d - A.d : B.d + daysIn(B.m === 1 ? B.y - 1 : B.y, B.m === 1 ? 12 : B.m - 1) - A.d; return prev }
        return ERR.num
      }
      // ── Conditional aggregates ──────────────────────────────────────────
      case "SUMIF":
      case "AVERAGEIF":
      case "COUNTIF": {
        if (args.length < 2) return ERR.value
        const hit = this.matchingIndices([{ range: args[0], crit: args[1] }])
        if (isError(hit)) return hit
        if (fn === "COUNTIF") return hit.idx.length
        const target = this.flat(args[2] ?? args[0])
        if (isError(target)) return target
        return this.aggregateAt(fn === "SUMIF" ? "sum" : "avg", target, hit.idx)
      }
      case "SUMIFS":
      case "AVERAGEIFS":
      case "MAXIFS":
      case "MINIFS":
      case "COUNTIFS": {
        const withTarget = fn !== "COUNTIFS"
        const start = withTarget ? 1 : 0
        if (args.length < start + 2 || (args.length - start) % 2 !== 0) return ERR.value
        const pairs: { range: Node; crit: Node }[] = []
        for (let i = start; i < args.length; i += 2) pairs.push({ range: args[i], crit: args[i + 1] })
        const hit = this.matchingIndices(pairs)
        if (isError(hit)) return hit
        if (!withTarget) return hit.idx.length
        const target = this.flat(args[0])
        if (isError(target)) return target
        return this.aggregateAt(fn === "SUMIFS" ? "sum" : fn === "AVERAGEIFS" ? "avg" : fn === "MAXIFS" ? "max" : "min", target, hit.idx)
      }
      // ── Lookup ──────────────────────────────────────────────────────────
      case "VLOOKUP":
      case "HLOOKUP": {
        // Exact match only. Approximate match silently returns the wrong row on unsorted data, so
        // it is refused rather than half-supported.
        if (args.length < 3) return ERR.value
        const key = this.evalScalar(args[0])
        if (isError(key)) return key
        const grid = this.matrix(args[1])
        if (isError(grid)) return grid
        const idx = num1(2); if (isError(idx)) return idx
        const n = Math.trunc(idx)
        if (n < 1) return ERR.value
        if (fn === "VLOOKUP") {
          for (const row of grid) {
            if (row[0] === null || row[0] === "" || compare(row[0], key) !== 0) continue
            return n > row.length ? ERR.ref : row[n - 1]
          }
        } else {
          const first = grid[0] ?? []
          for (let c = 0; c < first.length; c += 1) {
            if (first[c] === null || first[c] === "" || compare(first[c], key) !== 0) continue
            return n > grid.length ? ERR.ref : grid[n - 1][c]
          }
        }
        return ERR.na
      }
      case "XLOOKUP": {
        // XLOOKUP(key; lookup; return; [if_not_found]; [match_mode 0|-1|1|2]; [search_mode 1|-1])
        if (args.length < 3) return ERR.value
        const key = this.evalScalar(args[0])
        if (isError(key)) return key
        const look = this.matrix(args[1]); if (isError(look)) return look
        const ret = this.matrix(args[2]); if (isError(ret)) return ret
        const vertical = look.length > 1 || (look[0]?.length ?? 0) <= 1
        const keys = vertical ? look.map((r) => r[0]) : look[0]
        const mode = num1(4, 0); if (isError(mode)) return mode
        const search = num1(5, 1); if (isError(search)) return search
        const order = keys.map((_, i) => i)
        if (search < 0) order.reverse()
        let best = -1
        for (const i of order) {
          const k = keys[i]
          if (mode === 2 && typeof key === "string") {
            if (wildcardRegex(key).test(toText(k))) { best = i; break }
            continue
          }
          if (k !== null && k !== "" && compare(k, key) === 0) { best = i; break }
          if (mode === -1 && k !== null && k !== "" && compare(k, key) < 0 && (best < 0 || compare(k, keys[best]) > 0)) best = i
          if (mode === 1 && k !== null && k !== "" && compare(k, key) > 0 && (best < 0 || compare(k, keys[best]) < 0)) best = i
        }
        if (best < 0) return args[3] ? this.evalScalar(args[3]) : ERR.na
        if (vertical) return ret[best]?.[0] ?? ERR.ref
        return ret[0]?.[best] ?? ERR.ref
      }
      default: {
        const lib = FORMULAJS[fn] ?? FORMULAJS[fn.replace(/\./g, "")]
        if (!lib) return ERR.name
        return this.callFormulajs(fn, lib, args)
      }
    }
  }

  markVolatile() {
    const top = this.stack[this.stack.length - 1]
    if (top) this.volatile.add(top)
  }

  aggregateAt(kind: "sum" | "avg" | "max" | "min", target: CellValue[], idx: number[]): CellValue {
    const picked: number[] = []
    for (const i of idx) {
      const v = target[i]
      if (isError(v)) return v
      const n = typeof v === "number" ? v : typeof v === "string" ? numberFromText(v) : null
      if (n !== null) picked.push(n)
    }
    if (kind === "sum") return picked.reduce((s, x) => s + x, 0)
    if (kind === "avg") return picked.length ? picked.reduce((s, x) => s + x, 0) / picked.length : ERR.div
    if (!picked.length) return 0
    return kind === "max" ? Math.max(...picked) : Math.min(...picked)
  }

  callFormulajs(fn: string, lib: FjsFn, args: Node[]): CellValue {
    const dateAt = new Set(DATE_ARGS[fn] ?? [])
    const passed: unknown[] = []
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i]
      const asDate = (v: CellValue): unknown => {
        if (typeof v === "number") return serialToLocalDate(v)
        if (typeof v === "string" && v !== "") { const s = numberFromText(v); return s === null ? v : serialToLocalDate(s) }
        return v
      }
      if (a.n === "range") {
        const m = this.matrix(a)
        if (isError(m)) return m
        for (const row of m) for (const v of row) if (isError(v)) return v
        // Holiday lists and similar date ranges go in flat; formulajs rejects 2-D date arrays.
        passed.push(dateAt.has(i) ? m.flat().filter((v) => v !== null && v !== "").map(asDate) : m)
        continue
      }
      const v = this.evalScalar(a)
      if (isError(v)) return v
      passed.push(dateAt.has(i) ? asDate(v) : v)
    }
    let out: unknown
    try {
      out = lib(...passed)
    } catch {
      return ERR.value
    }
    return fromFormulajs(out)
  }

  /** Format inference: TODAY() reads as a date, A1*2 keeps A1's Rupiah, and so on. */
  formatOf(node: Node): NumFmt | null {
    switch (node.n) {
      case "ref": return this.colIndex.has(node.col) && this.rowIndex.has(node.row) ? this.format(node.row, node.col) : null
      case "range": return this.rangeFormat(node)
      case "neg": return this.formatOf(node.e)
      case "pct": return "pct"
      case "bin": {
        const l = this.formatOf(node.l), r = this.formatOf(node.r)
        if (node.op === "+" || node.op === "-") {
          if (l === "date" && r === "date") return node.op === "-" ? null : "date"
          if (l === "date" || r === "date") return "date"
          return l ?? r
        }
        if (node.op === "*") return [l, r].find((f) => f && f !== "pct" && f !== "date") ?? null
        if (node.op === "/") return l && l !== "pct" && l !== "date" && r !== l ? l : null
        return null
      }
      case "call": {
        if (DATE_RESULT.has(node.fn)) return "date"
        if (node.fn === "IF") return (node.args[1] && this.formatOf(node.args[1])) || (node.args[2] && this.formatOf(node.args[2])) || null
        if (node.fn === "IFERROR" || node.fn === "IFNA") return node.args[0] ? this.formatOf(node.args[0]) : null
        if (node.fn === "SUMIF") return node.args[2] ? this.formatOf(node.args[2]) : node.args[0] ? this.formatOf(node.args[0]) : null
        if (node.fn === "XLOOKUP") return node.args[2] ? this.formatOf(node.args[2]) : null
        if (node.fn === "INDEX") return node.args[0] ? this.formatOf(node.args[0]) : null
        if (node.fn === "VLOOKUP") return null
        if (FORMAT_OF_FIRST.has(node.fn)) {
          for (const a of node.args) { const f = this.formatOf(a); if (f) return f === "pct" && node.fn.startsWith("SUM") ? "pct" : f }
        }
        return null
      }
      default: return null
    }
  }

  rangeFormat(node: RangeNode): NumFmt | null {
    const ids = this.rangeIds(node)
    if (!ids) return null
    if (ids.cols.length === 1) {
      const type = this.data.types?.get(ids.cols[0])
      if (type === "currency") return "idr"
      if (type === "date") return "date"
    }
    // The first typed value in the range decides (a column of "Rp …" sums as Rupiah).
    let seen = 0
    for (const r of ids.rows) {
      for (const c of ids.cols) {
        const raw = this.data.cells.get(r)?.[c]
        if (raw === undefined || raw === null) continue
        if (isTypedCell(raw)) return raw.nf
        // A column of formulas that compute Rupiah (=C2*D2) sums as Rupiah too.
        if (isFormulaCell(raw)) { const f = this.format(r, c); if (f) return f }
        if (++seen > 200) return null
      }
    }
    return null
  }
}

function fromFormulajs(out: unknown): CellValue {
  if (out instanceof Error) return isError(out.message) ? (out.message as ErrorValue) : ERR.value
  if (out instanceof Date) return Number.isNaN(out.getTime()) ? ERR.value : localDateToSerial(out)
  if (Array.isArray(out)) return fromFormulajs(Array.isArray(out[0]) ? out[0][0] : out[0]) // no spill: first value
  if (out === undefined || out === null) return null
  if (typeof out === "number") return Number.isFinite(out) ? out : ERR.num
  if (typeof out === "string" || typeof out === "boolean") return out
  return ERR.value
}

/** TEXT(value; format) with Indonesian output: "#,##0" -> "1.500.000", "dd/mm/yyyy", "dddd", "0,0%". */
function textFormat(v: CellValue, fmt: string): CellValue {
  const f = fmt
  const unquoted = f.replace(/"[^"]*"/g, "")
  const isDate = /[dmy]/i.test(unquoted) && !/[0#]/.test(unquoted)
  if (isDate) {
    const s = typeof v === "number" ? v : typeof v === "string" ? numberFromText(v) : null
    if (s === null) return ERR.value
    const { y, m, d } = serialToYmd(s)
    const dow = weekdayOf(s)
    return f.replace(/"([^"]*)"|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, (tok, lit: string | undefined) => {
      if (lit !== undefined) return lit
      switch (tok.toLowerCase()) {
        case "yyyy": return String(y)
        case "yy": return String(y).slice(-2)
        case "mmmm": return monthName(m, true)
        case "mmm": return monthName(m, false)
        case "mm": return pad2(m)
        case "m": return String(m)
        case "dddd": return weekdayName(dow, true)
        case "ddd": return isEn() ? weekdayName(dow, false) : DAY_LONG_ID[dow].slice(0, 3)
        case "dd": return pad2(d)
        default: return String(d)
      }
    })
  }
  const n = typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : v === null || v === "" ? 0 : numberFromText(v)
  if (n === null) return typeof v === "string" ? v : ERR.value
  const m = /^([^0#]*)([#0][#0,.]*)(%?)([\s\S]*)$/.exec(f)
  if (!m) return toText(n)
  const [, prefix, pattern, pct, suffix] = m
  // Both "#,##0.00" (Sheets/English codes) and "#.##0,00" (Indonesian Excel codes) are accepted:
  // when both marks appear the last one is the decimal point; a lone mark followed by exactly three
  // digit codes after a "#" groups thousands, otherwise it is the decimal point.
  const lastDot = pattern.lastIndexOf("."), lastComma = pattern.lastIndexOf(",")
  let dec = ""
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? "." : ","
  else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? "." : ","
    const at = Math.max(lastDot, lastComma)
    const after = pattern.slice(at + 1)
    dec = after.length === 3 && pattern.slice(0, at).includes("#") ? "" : mark
  }
  const [intPat, fracPat = ""] = dec ? [pattern.slice(0, pattern.lastIndexOf(dec)), pattern.slice(pattern.lastIndexOf(dec) + 1)] : [pattern, ""]
  const decimals = fracPat.replace(/[^0#]/g, "").length
  const minDec = fracPat.replace(/[^0]/g, "").length
  const grouping = /[.,]/.test(intPat)
  const value = pct ? n * 100 : n
  return `${prefix.replace(/"/g, "")}${numberFormat(decimals, grouping, minDec).format(value)}${pct}${suffix.replace(/"/g, "")}`
}

const engines = new WeakMap<SheetData, SheetEngine>()
/** The engine for this exact SheetData object (one per render; see SheetEngine.derive). */
export function engineFor(data: SheetData, previous?: SheetEngine | null): SheetEngine {
  let e = engines.get(data)
  if (!e) {
    e = previous ? previous.derive(data) : new SheetEngine(data)
    engines.set(data, e)
  }
  return e
}

/** Evaluate one cell. Kept for older callers; shares the per-SheetData cache. */
export function evaluateCell(data: SheetData, rowId: string, colId: string): CellValue {
  return engineFor(data).value(rowId, colId)
}

export type ComputedCell = {
  /** Computed value: number (dates are serials), string, boolean, or an error text like "#REF!". */
  v: CellValue
  /** Text to show, formatted exactly like the web grid shows it. */
  d: string
  /** Display format when the value is a formatted number: num | idr | pct | date. */
  nf?: NumFmt
  /** Present on formula cells. */
  formula?: true
  /** Present when v is an error. */
  error?: true
}

/**
 * Every non-empty cell's computed value and display text. What GET /api/sheets/:id?computed=1
 * returns and what export writes, so phones and Excel see the same numbers as the web grid.
 */
export function computeSheet(
  columns: { id: string; type: string }[],
  rows: { id: string; cells: Record<string, unknown>; styles?: Record<string, { nf?: string; dp?: number; pt?: string }> | null }[],
  opts?: { locale?: DisplayLocale; names?: { name: string; range: string }[] },
): Record<string, Record<string, ComputedCell>> {
  const before = displayLocale
  if (opts?.locale) setDisplayLocale(opts.locale)
  try {
    return computeCells(columns, rows, opts?.names)
  } finally {
    displayLocale = before
  }
}

function computeCells(
  columns: { id: string; type: string }[],
  rows: { id: string; cells: Record<string, unknown>; styles?: Record<string, { nf?: string; dp?: number; pt?: string }> | null }[],
  names?: { name: string; range: string }[],
): Record<string, Record<string, ComputedCell>> {
  const data: SheetData = {
    shape: { columnIds: columns.map((c) => c.id), rowIds: rows.map((r) => r.id) },
    cells: new Map(rows.map((r) => [r.id, r.cells])),
    types: new Map(columns.map((c) => [c.id, c.type])),
    ...(names?.length ? { names: new Map(names.map((n) => [n.name.toUpperCase(), n.range])) } : {}),
  }
  const engine = new SheetEngine(data)
  const out: Record<string, Record<string, ComputedCell>> = {}
  for (const row of rows) {
    const line: Record<string, ComputedCell> = {}
    for (const col of columns) {
      const raw = row.cells[col.id]
      if (raw === undefined || raw === null || raw === "") continue
      const v = engine.value(row.id, col.id)
      const formula = isFormulaCell(raw)
      const nf = formula ? engine.format(row.id, col.id) : isTypedCell(raw) ? raw.nf : null
      const st = row.styles?.[col.id]
      const styled = st ? formatWithStyle(v, st.nf, st.dp, nf ?? (col.type === "currency" ? "idr" : col.type === "date" ? "date" : null), st.pt) : null
      const d = styled ?? (formula ? formatResult(col.type, v, nf) : formatScalar(col.type, raw))
      const cell: ComputedCell = { v, d }
      if (nf && typeof v === "number") cell.nf = nf
      else if (!formula && typeof v === "number" && (col.type === "date" || col.type === "currency")) cell.nf = col.type === "date" ? "date" : "idr"
      if (formula) cell.formula = true
      if (isError(v)) cell.error = true
      line[col.id] = cell
    }
    if (Object.keys(line).length) out[row.id] = line
  }
  return out
}

/**
 * Every function the engine runs, with what the autocomplete shows. `args` uses ";" (what people in
 * Indonesia type) — "," works too. Kept next to the evaluator so the dropdown never offers a function
 * that returns #NAME?.
 */
export const SUPPORTED_FUNCTIONS: { name: string; args: string; desc: string; descEn: string }[] = [
  { name: "SUM", args: "(angka; …)", desc: "Jumlahin deret angka atau sel.", descEn: "Adds numbers or cells." },
  { name: "SUMIF", args: "(rentang; kriteria; [rentang jumlah])", desc: "Jumlahin yang memenuhi syarat, mis. \">100\".", descEn: "Adds the values that meet a condition, e.g. \">100\"." },
  { name: "SUMIFS", args: "(rentang jumlah; rentang; kriteria; …)", desc: "Jumlahin dengan banyak syarat.", descEn: "Adds with several conditions." },
  { name: "SUMPRODUCT", args: "(rentang; rentang; …)", desc: "Kaliin per baris lalu jumlahin.", descEn: "Multiplies row by row, then adds." },
  { name: "AVERAGE", args: "(angka; …)", desc: "Rata-rata dari angka atau sel.", descEn: "Average of numbers or cells." },
  { name: "AVERAGEIF", args: "(rentang; kriteria; [rentang rata-rata])", desc: "Rata-rata yang memenuhi syarat.", descEn: "Average of the values that meet a condition." },
  { name: "AVERAGEIFS", args: "(rentang rata-rata; rentang; kriteria; …)", desc: "Rata-rata dengan banyak syarat.", descEn: "Average with several conditions." },
  { name: "MEDIAN", args: "(angka; …)", desc: "Nilai tengah.", descEn: "Middle value." },
  { name: "MIN", args: "(angka; …)", desc: "Nilai terkecil.", descEn: "Smallest value." },
  { name: "MAX", args: "(angka; …)", desc: "Nilai terbesar.", descEn: "Largest value." },
  { name: "MINIFS", args: "(rentang; rentang; kriteria; …)", desc: "Nilai terkecil yang memenuhi syarat.", descEn: "Smallest value that meets the conditions." },
  { name: "MAXIFS", args: "(rentang; rentang; kriteria; …)", desc: "Nilai terbesar yang memenuhi syarat.", descEn: "Largest value that meets the conditions." },
  { name: "COUNT", args: "(rentang)", desc: "Hitung sel yang isinya angka.", descEn: "Counts cells that hold numbers." },
  { name: "COUNTA", args: "(rentang)", desc: "Hitung sel yang nggak kosong.", descEn: "Counts cells that aren't empty." },
  { name: "COUNTBLANK", args: "(rentang)", desc: "Hitung sel yang kosong.", descEn: "Counts empty cells." },
  { name: "COUNTIF", args: "(rentang; kriteria)", desc: "Hitung yang memenuhi syarat.", descEn: "Counts the cells that meet a condition." },
  { name: "COUNTIFS", args: "(rentang; kriteria; …)", desc: "Hitung yang memenuhi banyak syarat.", descEn: "Counts with several conditions." },
  { name: "PRODUCT", args: "(angka; …)", desc: "Kaliin semua angka.", descEn: "Multiplies all numbers." },
  { name: "ROUND", args: "(angka; digit)", desc: "Bulatkan ke sekian angka di belakang koma.", descEn: "Rounds to a number of decimals." },
  { name: "ROUNDUP", args: "(angka; digit)", desc: "Bulatkan ke atas.", descEn: "Rounds up." },
  { name: "ROUNDDOWN", args: "(angka; digit)", desc: "Bulatkan ke bawah.", descEn: "Rounds down." },
  { name: "MROUND", args: "(angka; kelipatan)", desc: "Bulatkan ke kelipatan terdekat.", descEn: "Rounds to the nearest multiple." },
  { name: "CEILING", args: "(angka; kelipatan)", desc: "Bulatkan ke atas ke kelipatan.", descEn: "Rounds up to a multiple." },
  { name: "FLOOR", args: "(angka; kelipatan)", desc: "Bulatkan ke bawah ke kelipatan.", descEn: "Rounds down to a multiple." },
  { name: "INT", args: "(angka)", desc: "Buang koma, bulatkan ke bawah.", descEn: "Drops the decimals, rounding down." },
  { name: "TRUNC", args: "(angka; [digit])", desc: "Potong angka di belakang koma.", descEn: "Truncates decimals." },
  { name: "ABS", args: "(angka)", desc: "Nilai mutlak (buang tanda minus).", descEn: "Absolute value." },
  { name: "MOD", args: "(angka; pembagi)", desc: "Sisa bagi.", descEn: "Remainder of a division." },
  { name: "SQRT", args: "(angka)", desc: "Akar kuadrat.", descEn: "Square root." },
  { name: "POWER", args: "(angka; pangkat)", desc: "Pangkat.", descEn: "Raises to a power." },
  { name: "LARGE", args: "(rentang; ke-n)", desc: "Nilai terbesar ke-n.", descEn: "The n-th largest value." },
  { name: "SMALL", args: "(rentang; ke-n)", desc: "Nilai terkecil ke-n.", descEn: "The n-th smallest value." },
  { name: "RANK", args: "(angka; rentang; [urutan])", desc: "Peringkat angka di dalam rentang.", descEn: "Rank of a number within a range." },
  { name: "STDEV", args: "(rentang)", desc: "Simpangan baku (sampel).", descEn: "Standard deviation (sample)." },
  { name: "PERCENTILE", args: "(rentang; k)", desc: "Persentil ke-k (0–1).", descEn: "k-th percentile (0–1)." },
  { name: "IF", args: "(syarat; kalau benar; kalau salah)", desc: "Pilih nilai berdasarkan syarat.", descEn: "Picks a value based on a condition." },
  { name: "IFS", args: "(syarat; nilai; …)", desc: "Syarat pertama yang benar menang.", descEn: "The first true condition wins." },
  { name: "IFERROR", args: "(nilai; kalau error)", desc: "Ganti hasil error dengan nilai lain.", descEn: "Replaces an error with another value." },
  { name: "IFNA", args: "(nilai; kalau #N/A)", desc: "Ganti #N/A dengan nilai lain.", descEn: "Replaces #N/A with another value." },
  { name: "AND", args: "(syarat; …)", desc: "Benar kalau semuanya benar.", descEn: "True when all are true." },
  { name: "OR", args: "(syarat; …)", desc: "Benar kalau salah satu benar.", descEn: "True when any is true." },
  { name: "NOT", args: "(syarat)", desc: "Kebalikan dari syarat.", descEn: "Reverses a condition." },
  { name: "SWITCH", args: "(nilai; kasus; hasil; …; [default])", desc: "Pilih hasil berdasarkan nilai.", descEn: "Picks a result by value." },
  { name: "CHOOSE", args: "(ke-n; pilihan1; pilihan2; …)", desc: "Ambil pilihan ke-n.", descEn: "Returns the n-th choice." },
  { name: "ISBLANK", args: "(nilai)", desc: "Benar kalau kosong.", descEn: "True when empty." },
  { name: "ISNUMBER", args: "(nilai)", desc: "Benar kalau angka.", descEn: "True when a number." },
  { name: "ISTEXT", args: "(nilai)", desc: "Benar kalau teks.", descEn: "True when text." },
  { name: "ISERROR", args: "(nilai)", desc: "Benar kalau error.", descEn: "True when an error." },
  { name: "VLOOKUP", args: "(kunci; rentang; nomor kolom)", desc: "Cari baris, ambil kolom ke-N. Cocok persis.", descEn: "Finds a row, returns its N-th column. Exact match." },
  { name: "HLOOKUP", args: "(kunci; rentang; nomor baris)", desc: "Cari kolom, ambil baris ke-N. Cocok persis.", descEn: "Finds a column, returns its N-th row. Exact match." },
  { name: "XLOOKUP", args: "(kunci; rentang cari; rentang hasil; [kalau tak ada])", desc: "Cari kunci, ambil nilai di posisi yang sama.", descEn: "Finds a key and returns the value at the same position." },
  { name: "INDEX", args: "(rentang; baris; [kolom])", desc: "Ambil nilai di baris/kolom ke-N.", descEn: "Returns the value at a row/column." },
  { name: "MATCH", args: "(kunci; rentang; 0)", desc: "Posisi kunci di rentang (0 = cocok persis).", descEn: "Position of a key in a range (0 = exact)." },
  { name: "CONCAT", args: "(teks; …)", desc: "Sambung teks jadi satu.", descEn: "Joins text." },
  { name: "TEXTJOIN", args: "(pemisah; abaikan kosong; teks; …)", desc: "Sambung teks pakai pemisah.", descEn: "Joins text with a delimiter." },
  { name: "TEXT", args: "(nilai; \"format\")", desc: "Angka/tanggal jadi teks, mis. \"#,##0\" atau \"dd/mm/yyyy\".", descEn: "Number/date as text, e.g. \"#,##0\" or \"dd/mm/yyyy\"." },
  { name: "VALUE", args: "(teks)", desc: "Teks jadi angka (paham \"Rp 1.500.000\").", descEn: "Text to number (understands \"Rp 1.500.000\")." },
  { name: "LEN", args: "(teks)", desc: "Jumlah karakter.", descEn: "Number of characters." },
  { name: "UPPER", args: "(teks)", desc: "Jadiin HURUF BESAR.", descEn: "To UPPER CASE." },
  { name: "LOWER", args: "(teks)", desc: "Jadiin huruf kecil.", descEn: "To lower case." },
  { name: "PROPER", args: "(teks)", desc: "Huruf Depan Kapital.", descEn: "Capitalises Each Word." },
  { name: "TRIM", args: "(teks)", desc: "Buang spasi berlebih.", descEn: "Removes extra spaces." },
  { name: "LEFT", args: "(teks; jumlah)", desc: "Ambil karakter dari kiri.", descEn: "Characters from the left." },
  { name: "RIGHT", args: "(teks; jumlah)", desc: "Ambil karakter dari kanan.", descEn: "Characters from the right." },
  { name: "MID", args: "(teks; mulai; jumlah)", desc: "Ambil karakter dari tengah.", descEn: "Characters from the middle." },
  { name: "FIND", args: "(cari; teks)", desc: "Posisi teks yang dicari (huruf besar/kecil beda).", descEn: "Position of a text (case-sensitive)." },
  { name: "SEARCH", args: "(cari; teks)", desc: "Posisi teks yang dicari (huruf besar/kecil sama).", descEn: "Position of a text (case-insensitive)." },
  { name: "SUBSTITUTE", args: "(teks; lama; baru)", desc: "Ganti sebagian teks.", descEn: "Replaces part of a text." },
  { name: "REPT", args: "(teks; jumlah)", desc: "Ulang teks sekian kali.", descEn: "Repeats a text." },
  { name: "TODAY", args: "()", desc: "Tanggal hari ini (WIB).", descEn: "Today's date (Jakarta time)." },
  { name: "NOW", args: "()", desc: "Tanggal & jam sekarang (WIB).", descEn: "Current date and time (Jakarta time)." },
  { name: "DATE", args: "(tahun; bulan; tanggal)", desc: "Bikin tanggal.", descEn: "Builds a date." },
  { name: "DATEVALUE", args: "(teks)", desc: "Teks \"11/10/2026\" jadi tanggal.", descEn: "Text like \"11/10/2026\" to a date." },
  { name: "YEAR", args: "(tanggal)", desc: "Ambil tahunnya.", descEn: "The year." },
  { name: "MONTH", args: "(tanggal)", desc: "Ambil bulannya.", descEn: "The month." },
  { name: "DAY", args: "(tanggal)", desc: "Ambil tanggalnya.", descEn: "The day of the month." },
  { name: "WEEKDAY", args: "(tanggal; [tipe])", desc: "Hari ke berapa dalam minggu (1 = Minggu).", descEn: "Day of the week (1 = Sunday)." },
  { name: "WEEKNUM", args: "(tanggal)", desc: "Minggu ke berapa dalam tahun.", descEn: "Week number in the year." },
  { name: "EOMONTH", args: "(tanggal; bulan)", desc: "Tanggal terakhir bulan itu (± bulan).", descEn: "Last day of the month (± months)." },
  { name: "EDATE", args: "(tanggal; bulan)", desc: "Tanggal yang sama ± sekian bulan.", descEn: "Same date ± months." },
  { name: "DATEDIF", args: "(mulai; selesai; \"D\"|\"M\"|\"Y\")", desc: "Selisih tanggal dalam hari/bulan/tahun.", descEn: "Difference in days/months/years." },
  { name: "DAYS", args: "(selesai; mulai)", desc: "Jumlah hari di antara dua tanggal.", descEn: "Days between two dates." },
  { name: "NETWORKDAYS", args: "(mulai; selesai; [libur])", desc: "Jumlah hari kerja (Sen–Jum).", descEn: "Working days (Mon–Fri)." },
  { name: "WORKDAY", args: "(mulai; hari; [libur])", desc: "Tanggal setelah sekian hari kerja.", descEn: "Date after a number of working days." },
  { name: "YEARFRAC", args: "(mulai; selesai)", desc: "Pecahan tahun di antara dua tanggal.", descEn: "Fraction of a year between dates." },
  { name: "PMT", args: "(bunga; periode; pokok)", desc: "Cicilan per periode.", descEn: "Payment per period." },
  { name: "FV", args: "(bunga; periode; cicilan)", desc: "Nilai masa depan.", descEn: "Future value." },
  { name: "PV", args: "(bunga; periode; cicilan)", desc: "Nilai sekarang.", descEn: "Present value." },
  { name: "NPV", args: "(bunga; arus kas; …)", desc: "Nilai bersih sekarang.", descEn: "Net present value." },
  { name: "IRR", args: "(arus kas)", desc: "Tingkat pengembalian internal.", descEn: "Internal rate of return." },
]
