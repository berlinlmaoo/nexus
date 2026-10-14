// Number custom fields as people in Indonesia type them, and how they read (Notion-style formats).
//
// Owner bug (12 Oct 2026): "369.000" typed into a Rupiah field was stored as the text "369.000" and
// the web board read it as Number("369.000") = 369 → "Rp 369". Every write of a NUMBER custom field
// now goes through normalizeNumberFieldValue on the server (the source of truth), so what is stored is
// a plain machine number: digits only for Rupiah, "1500000" / "1.5" for plain numbers.
//
// The rules follow the Sheets parser (src/lib/sheet-formula.ts parseLocaleNumber, id-ID): "." groups
// thousands, "," is the decimal mark, and when both appear the last one is the decimal mark. Rupiah has
// no cents in practice, so a Rupiah field reads one extra case as grouping: a separator followed by
// three or more digits ("369.000", "13.600000", "280,000") is a thousands-grouping mistake, never a
// fraction. One or two digits after the last separator ("150.000,50") are cents and are rounded —
// unless the field shows decimal places (1..5), then they are kept.
//
// Number formats (owner, 15 Oct 2026, the same options as Notion): a NUMBER field's options carry
//   { format?: "currency-idr", numberFormat?, decimals?, showAs?, barColor?, divideBy?, showNumber? }
// `format: "currency-idr"` is the legacy key that released apps read; it is written only for Rupiah.
// Absent keys mean the default. Every number reads with Indonesian grouping whatever the UI language
// ("1.234.567,89", "Rp 6.000.000", "42%"), and a negative carries the true minus sign ("−Rp 1.501").
//
// Self-contained on purpose (no imports): this exact file is also
// apps/web/src/lib/custom-field-number.ts — keep the two copies identical
// (src/lib/custom-field-number.test.mjs checks).

export type NumberFieldFormat = "plain" | "currency-idr"

const IDR_FORMAT = /^(currency-idr|idr|rupiah)$/i

/** The minus sign (U+2212), not the hyphen: it lines up with the digits in tabular figures. */
const MINUS = "\u2212"

// ─── formats ─────────────────────────────────────────────────────────────────────────────────────────

/** Currencies in the picker's order: Notion's, with Rupiah pinned first (the company's currency). */
export const NUMBER_CURRENCIES = [
  "IDR", "USD", "AUD", "CAD", "SGD", "EUR", "GBP", "JPY", "RUB", "INR", "KRW", "CNY", "BRL", "TRY", "CHF", "HKD",
  "NZD", "SEK", "NOK", "MXN", "ZAR", "TWD", "DKK", "PLN", "THB", "HUF", "CZK", "ILS", "CLP", "PHP", "AED", "COP",
  "SAR", "MYR", "RON", "ARS", "UYU", "PEN", "VND", "PKR", "NGN",
] as const

/** Every format, in the order the picker lists them. */
export const NUMBER_FORMATS: readonly string[] = ["number", "number_with_separators", "percent", ...NUMBER_CURRENCIES, "BTC"]

/** English and Indonesian names (the Indonesian ones follow Notion's id-ID labels). */
export const NUMBER_FORMAT_LABELS: Record<string, { en: string; id: string }> = {
  number: { en: "Number", id: "Angka" },
  number_with_separators: { en: "Number with separators", id: "Angka dengan pemisah" },
  percent: { en: "Percent", id: "Persen" },
  USD: { en: "US Dollar (USD)", id: "Dolar AS (USD)" },
  AUD: { en: "Australian dollar (AUD)", id: "Dolar Australia (AUD)" },
  CAD: { en: "Canadian dollar (CAD)", id: "Dolar Kanada (CAD)" },
  SGD: { en: "Singapore dollar (SGD)", id: "Dolar Singapura (SGD)" },
  EUR: { en: "Euro (EUR)", id: "Euro (EUR)" },
  GBP: { en: "Pound (GBP)", id: "Pound (GBP)" },
  JPY: { en: "Yen (JPY)", id: "Yen (JPY)" },
  RUB: { en: "Ruble (RUB)", id: "Rubel (RUB)" },
  INR: { en: "Rupee (INR)", id: "Rupe (INR)" },
  KRW: { en: "Won (KRW)", id: "Won (KRW)" },
  CNY: { en: "Yuan (CNY)", id: "Yuan (CNY)" },
  BRL: { en: "Real (BRL)", id: "Real (BRL)" },
  TRY: { en: "Lira (TRY)", id: "Lira (TRY)" },
  IDR: { en: "Rupiah (IDR)", id: "Rupiah (IDR)" },
  CHF: { en: "Franc (CHF)", id: "Franc (CHF)" },
  HKD: { en: "Hong Kong dollar (HKD)", id: "Dolar Hong Kong (HKD)" },
  NZD: { en: "New Zealand dollar (NZD)", id: "Dolar Selandia Baru (NZD)" },
  SEK: { en: "Swedish krona (SEK)", id: "Krona Swedia (SEK)" },
  NOK: { en: "Norwegian krone (NOK)", id: "Krona Norwegia (NOK)" },
  MXN: { en: "Mexican peso (MXN)", id: "Peso Meksiko (MXN)" },
  ZAR: { en: "Rand (ZAR)", id: "Rand (ZAR)" },
  TWD: { en: "New Taiwan dollar (TWD)", id: "Dolar Baru Taiwan (TWD)" },
  DKK: { en: "Danish krone (DKK)", id: "Krona Denmark (DKK)" },
  PLN: { en: "Złoty (PLN)", id: "Złoty (PLN)" },
  THB: { en: "Baht (THB)", id: "Baht (THB)" },
  HUF: { en: "Forint (HUF)", id: "Forint (HUF)" },
  CZK: { en: "Koruna (CZK)", id: "Koruna (CZK)" },
  ILS: { en: "Shekel (ILS)", id: "Shekel (ILS)" },
  CLP: { en: "Chilean peso (CLP)", id: "Peso Chili (CLP)" },
  PHP: { en: "Philippine peso (PHP)", id: "Peso Filipina (PHP)" },
  AED: { en: "Dirham (AED)", id: "Dirham (AED)" },
  COP: { en: "Colombian peso (COP)", id: "Peso Kolombia (COP)" },
  SAR: { en: "Riyal (SAR)", id: "Riyal (SAR)" },
  MYR: { en: "Ringgit (MYR)", id: "Ringgit (MYR)" },
  RON: { en: "Leu (RON)", id: "Leu (RON)" },
  ARS: { en: "Argentine peso (ARS)", id: "Peso Argentina (ARS)" },
  UYU: { en: "Uruguayan peso (UYU)", id: "Peso Uruguay (UYU)" },
  PEN: { en: "Peruvian sol (PEN)", id: "Sol Peru (PEN)" },
  VND: { en: "Vietnamese dong (VND)", id: "Dong Vietnam (VND)" },
  PKR: { en: "Pakistani rupee (PKR)", id: "Rupe Pakistan (PKR)" },
  NGN: { en: "Nigerian naira (NGN)", id: "Naira Nigeria (NGN)" },
  BTC: { en: "Bitcoin (BTC)", id: "Bitcoin (BTC)" },
}

export type NumberShowAs = "number" | "bar" | "ring"
export const NUMBER_SHOW_AS: readonly NumberShowAs[] = ["number", "bar", "ring"]
export const BAR_COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const
export type BarColor = (typeof BAR_COLORS)[number]
/** Decimal places a field can fix; null is "Default". */
export const NUMBER_DECIMALS = [0, 1, 2, 3, 4, 5] as const

/** A NUMBER field's display settings, with every default filled in. */
export type NumberOptions = {
  /** "number" | "number_with_separators" | "percent" | "BTC" | an ISO 4217 code from NUMBER_CURRENCIES. */
  numberFormat: string
  /** 0..5, or null for "Default". */
  decimals: number | null
  showAs: NumberShowAs
  barColor: BarColor
  divideBy: number
  showNumber: boolean
}

export const DEFAULT_NUMBER_OPTIONS: NumberOptions = {
  numberFormat: "number_with_separators",
  decimals: null,
  showAs: "number",
  barColor: "default",
  divideBy: 100,
  showNumber: true,
}

function asObject(options: unknown): Record<string, unknown> | null {
  return options && typeof options === "object" && !Array.isArray(options) ? (options as Record<string, unknown>) : null
}

function knownFormat(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  return NUMBER_FORMATS.includes(v) ? v : undefined
}

function validDecimals(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5 ? v : undefined
}

function validDivideBy(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * A NUMBER field's settings from its stored options. Compat: `numberFormat` when known; else the legacy
 * `format` ("currency-idr" | "idr" | "rupiah", or the bare string) means Rupiah; else "Number with
 * separators", which is what NEXUS showed before formats existed. An unknown `numberFormat` (a newer
 * client) also reads as "Number with separators".
 */
export function numberOptions(options: unknown): NumberOptions {
  const o = asObject(options)
  const legacy = typeof options === "string" ? options : o && typeof o.format === "string" ? o.format : ""
  const numberFormat =
    knownFormat(o?.numberFormat) ?? (IDR_FORMAT.test(legacy.trim()) ? "IDR" : DEFAULT_NUMBER_OPTIONS.numberFormat)
  if (!o) return { ...DEFAULT_NUMBER_OPTIONS, numberFormat }
  return {
    numberFormat,
    decimals: validDecimals(o.decimals) ?? null,
    showAs: NUMBER_SHOW_AS.includes(o.showAs as NumberShowAs) ? (o.showAs as NumberShowAs) : "number",
    barColor: BAR_COLORS.includes(o.barColor as BarColor) ? (o.barColor as BarColor) : "default",
    divideBy: validDivideBy(o.divideBy) ?? 100,
    showNumber: typeof o.showNumber === "boolean" ? o.showNumber : true,
  }
}

/** The display format of a NUMBER field from its options ({ format: "currency-idr" } or the bare string). */
export function numberFieldFormat(options: unknown): NumberFieldFormat {
  return numberOptions(options).numberFormat === "IDR" ? "currency-idr" : "plain"
}

/**
 * The options object to STORE for a NUMBER field (write side, server and clients). Keeps only valid keys,
 * drops default-valued ones, and writes the legacy `format: "currency-idr"` exactly when the format is
 * Rupiah. Accepts the legacy shapes too ("currency-idr", { format }). null = no settings (plain number).
 */
export function numberOptionsToStore(options: unknown): Record<string, unknown> | null {
  const o = asObject(options)
  const legacy = typeof options === "string" ? options : o && typeof o.format === "string" ? o.format : ""
  const numberFormat = knownFormat(o?.numberFormat) ?? (IDR_FORMAT.test(legacy.trim()) ? "IDR" : undefined)
  const out: Record<string, unknown> = {}
  if (numberFormat === "IDR") out.format = "currency-idr"
  if (numberFormat) out.numberFormat = numberFormat
  if (o) {
    const decimals = validDecimals(o.decimals)
    if (decimals !== undefined) out.decimals = decimals
    if (o.showAs === "bar" || o.showAs === "ring") out.showAs = o.showAs
    if (BAR_COLORS.includes(o.barColor as BarColor) && o.barColor !== "default") out.barColor = o.barColor
    const divideBy = validDivideBy(o.divideBy)
    if (divideBy !== undefined && divideBy !== 100) out.divideBy = divideBy
    if (o.showNumber === false) out.showNumber = false
  }
  return Object.keys(out).length ? out : null
}

/** "Rupiah (IDR)", or the short name next to "Number format" ("Rupiah", "Number", "Percent"). */
export function numberFormatLabel(format: string, lang: "en" | "id", short = false): string {
  const l = NUMBER_FORMAT_LABELS[format] ?? NUMBER_FORMAT_LABELS.number_with_separators
  const name = lang === "id" ? l.id : l.en
  return short ? name.replace(/\s*\([A-Z]{3}\)$/, "") : name
}

/** How well `q` matches `text`: a substring first, then the letters in order within a short span. */
function fuzzyScore(text: string, q: string): number | null {
  const at = text.indexOf(q)
  if (at !== -1) return at === 0 || /[\s(]/.test(text[at - 1]) ? 0 : 1
  let i = 0
  let first = -1
  for (let j = 0; j < text.length && i < q.length; j++) {
    if (text[j] === q[i]) { if (first < 0) first = j; i++ }
    if (i === q.length && j - first + 1 > q.length * 4) return null
  }
  return i === q.length ? 2 : null
}

/** "Filter formats…": the formats whose name (in the UI language, code included) fuzzily matches, best matches first. */
export function filterNumberFormats(query: string, lang: "en" | "id"): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...NUMBER_FORMATS]
  const scored: Array<[string, number, number]> = []
  NUMBER_FORMATS.forEach((f, idx) => {
    const best = fuzzyScore(numberFormatLabel(f, lang).toLowerCase(), q)
    if (best !== null) scored.push([f, best, idx])
  })
  return scored.sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0])
}

// ─── display ─────────────────────────────────────────────────────────────────────────────────────────

const intlCache = new Map<string, Intl.NumberFormat>()
function intl(key: string, make: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = intlCache.get(key)
  if (!f) { f = make(); intlCache.set(key, f) }
  return f
}

/** Fraction digits a number carries in its shortest form (0.1 → 1, 1e-7 → 7), at most 20. */
function fractionDigits(n: number): number {
  const s = Math.abs(n).toString()
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(s)
  if (!m) return 0
  const frac = (m[2] ?? "").length - (m[3] ? Number(m[3]) : 0)
  return Math.max(0, Math.min(20, frac))
}

/** Indonesian grouping: "1.234.567,891". `min`/`max` fraction digits. */
function grouped(abs: number, min: number, max: number): string {
  return intl(`g${min}/${max}`, () => new Intl.NumberFormat("id-ID", { minimumFractionDigits: min, maximumFractionDigits: max })).format(abs)
}

function signed(neg: boolean, body: string): string {
  return neg && /[1-9]/.test(body) ? MINUS + body : body
}

/** A number in a field's format: "1.234.567,89", "42%", "Rp 6.000.000", "US$1.234,00", "₿0,5", "−Rp 1.501". */
export function formatNumberWith(n: number, options: NumberOptions): string {
  if (!Number.isFinite(n)) return ""
  const { numberFormat: f, decimals } = options
  const neg = n < 0
  const abs = Math.abs(n)
  const fixed = (d: number | null, raw: number) => (d === null ? grouped(abs, 0, raw) : grouped(abs, d, d))
  if (f === "percent") {
    const v = abs * 100
    const d = decimals ?? Math.max(0, fractionDigits(abs) - 2)
    return signed(neg, `${grouped(v, decimals === null ? 0 : d, d)}%`)
  }
  if (f === "IDR") {
    const d = decimals ?? 0
    return signed(neg, `Rp ${grouped(abs, d, d)}`)
  }
  if (f === "BTC") return signed(neg, `\u20bf${fixed(decimals, fractionDigits(abs))}`)
  if ((NUMBER_CURRENCIES as readonly string[]).includes(f)) {
    try {
      const cf = intl(`c${f}/${decimals ?? ""}`, () =>
        new Intl.NumberFormat("id-ID", decimals === null
          ? { style: "currency", currency: f }
          : { style: "currency", currency: f, minimumFractionDigits: decimals, maximumFractionDigits: decimals }))
      return signed(neg, cf.format(abs).replace(/[\u00a0\u202f]/g, " "))
    } catch {
      return signed(neg, `${f} ${fixed(decimals ?? 2, 0)}`)
    }
  }
  return signed(neg, fixed(decimals, fractionDigits(abs)))
}

const MACHINE_NUMBER = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i

/**
 * The number a stored NUMBER value holds, or null (empty, or text that is no number). A machine number
 * ("1.234" is 1,234 thousandths here, as stored) reads as itself; a legacy typed value ("369.000" in a
 * Rupiah field, "1.500" typed before values were normalised) goes through the typing rules.
 */
export function storedNumber(value: unknown, options: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const raw = Array.isArray(value) ? String(value[0] ?? "") : String(value)
  const s = raw.trim()
  if (!s) return null
  const o = numberOptions(options)
  const wholeRupiah = o.numberFormat === "IDR" && !o.decimals
  // In a whole-rupiah field "369.000" is a legacy typed amount (thousands grouping). A dot after four or more
  // digits ("1234.567", stored while the field still showed 3 decimals) can be no grouping: a machine number.
  if (MACHINE_NUMBER.test(s) && (!wholeRupiah || /^-?\d{4,}\.\d+$/.test(s))) return Number(s)
  const n = normalizeNumberFieldValue(s, options)
  return n && MACHINE_NUMBER.test(n) ? Number(n) : null
}

/** A stored value in its field's format; text that is no number shows as it is; empty → "". */
export function formatNumberField(value: unknown, options: unknown): string {
  const n = storedNumber(value, options)
  if (n === null) return typeof value === "string" ? value.trim() : ""
  return formatNumberWith(n, numberOptions(options))
}

/** Bar / Ring fill, 0..1: value ÷ Divide by, or the stored fraction itself for Percent. */
export function numberFill(n: number, options: NumberOptions): number {
  if (!Number.isFinite(n)) return 0
  const r = options.numberFormat === "percent" ? n : n / (options.divideBy > 0 ? options.divideBy : 100)
  return Math.min(1, Math.max(0, r))
}

// ─── typing ──────────────────────────────────────────────────────────────────────────────────────────

type Parsed = { neg: boolean; int: string; frac: string }

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/(?:rb|ribu|k)$/i, 1_000],
  [/(?:jt|juta)$/i, 1_000_000],
]

function stripCurrency(raw: string): { s: string; neg: boolean } {
  let s = raw.replace(/[\s  ]+/g, "")
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1) }
  // A currency mark typed with the amount: "Rp", "IDR", "$", "US$", "€", "£", "¥", "₿"…
  s = s.replace(/^(?:rp\.?|idr|[a-z]{0,3}\$|[€£¥₩₫₹₿])/i, "")
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1) }
  else if (s.startsWith("+")) s = s.slice(1)
  // "Rp 50.000,-" / "Rp 50.000,00-" — the Indonesian "no cents" dash.
  s = s.replace(/[.,]?-+$/, "")
  return { s, neg }
}

function parseDigits(s: string, idr: boolean): Parsed | null {
  if (!/^(\d[\d.,]*|[.,]\d+)$/.test(s)) return null
  s = s.replace(/[.,]+$/, "")
  const dots = (s.match(/\./g) ?? []).length
  const commas = (s.match(/,/g) ?? []).length
  if (dots && commas) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ","
    const grp = dec === "." ? "," : "."
    const parts = s.split(dec)
    if (parts.length !== 2) {
      // "1.500.000.00,5"-style noise: only a Rupiah field can still read it (as grouping).
      return idr ? { neg: false, int: s.replace(/[.,]/g, ""), frac: "" } : null
    }
    const [a, b] = parts
    if (idr && b.length >= 3) return { neg: false, int: s.replace(/[.,]/g, ""), frac: "" }
    if (!idr && !validGrouping(a, grp)) return null
    return { neg: false, int: a.split(grp).join(""), frac: b }
  }
  if (dots || commas) {
    const ch = dots ? "." : ","
    const parts = s.split(ch)
    if (parts.length > 2) {
      if (!idr && !validGrouping(s, ch)) return null
      return { neg: false, int: parts.join(""), frac: "" }
    }
    const [a, b] = parts
    if (idr) {
      // Three or more digits after the mark: grouping ("369.000", "13.600000", "280,000").
      return b.length >= 3 ? { neg: false, int: a + b, frac: "" } : { neg: false, int: a, frac: b }
    }
    // Plain numbers, id-ID: a lone "." groups only when exactly three digits follow ("1.500");
    // a lone "," is always the decimal mark ("1,5").
    const grouped = ch === "." && b.length === 3 && /^[1-9]\d{0,2}$/.test(a)
    return grouped ? { neg: false, int: a + b, frac: "" } : { neg: false, int: a, frac: b }
  }
  return { neg: false, int: s, frac: "" }
}

function validGrouping(x: string, g: string): boolean {
  const parts = x.split(g)
  if (!/^\d{1,3}$/.test(parts[0])) return false
  return parts.slice(1).every((p) => /^\d{3}$/.test(p))
}

function trimZeros(digits: string): string {
  const t = digits.replace(/^0+(?=\d)/, "")
  return t || "0"
}

/** Add one to a non-negative decimal digit string ("999" → "1000") — exact for any length. */
function incrementDigits(d: string): string {
  const a = d.split("")
  let i = a.length - 1
  while (i >= 0) {
    if (a[i] === "9") { a[i] = "0"; i-- }
    else { a[i] = String(Number(a[i]) + 1); return a.join("") }
  }
  return "1" + a.join("")
}

function idrFromParsed(p: Parsed, keepDecimals = 0): string {
  let int = trimZeros(p.int || "0")
  if (keepDecimals > 0 && p.frac) {
    // Rupiah with decimal places (1..5): keep the fraction, rounded to the field's places.
    const n = Number(`${int}.${p.frac}`)
    if (Number.isFinite(n) && int.length <= 15) {
      const r = String(Number(n.toFixed(keepDecimals)))
      return (p.neg && r !== "0" ? "-" : "") + r
    }
  }
  if (p.frac && Number(p.frac[0]) >= 5) int = incrementDigits(int)
  return (p.neg && int !== "0" ? "-" : "") + int
}

function plainFromParsed(p: Parsed): string | null {
  const int = trimZeros(p.int || "0")
  const frac = p.frac.replace(/0+$/, "")
  if (int.length > 15) return null
  const n = Number(`${int}.${frac || "0"}`)
  if (!Number.isFinite(n)) return null
  return String(p.neg && n !== 0 ? -n : n)
}

/**
 * What to STORE for a NUMBER custom field. Rupiah → integer digits ("Rp 369.000" → "369000",
 * "13.600000" → "13600000", "1,5jt" → "1500000"); plain → a JS-readable number ("1.500" → "1500",
 * "2,5" → "2.5"). Empty → "". Text that is not a number: Rupiah keeps its digits (the old web
 * behaviour), plain keeps the text unchanged (nothing is destroyed).
 */
export function normalizeNumberFieldValue(value: unknown, options: unknown): string {
  if (value === null || value === undefined) return ""
  const opts = numberOptions(options)
  const idr = opts.numberFormat === "IDR"
  // Rupiah keeps a fraction only when the field shows decimal places; Default / 0 is whole rupiah.
  const keep = idr ? opts.decimals ?? 0 : 0
  let raw: string
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ""
    // A JSON number never carries grouping, but 243.351 sent as a number for a Rupiah field is the
    // same mistake as the text "243.351" — read it the same way. (369.000 as a JSON number already
    // arrives as 369; nothing can recover the zeros.)
    raw = Math.abs(value) >= 1e15 ? value.toFixed(0) : String(value)
  } else if (typeof value === "string") {
    raw = value
  } else if (Array.isArray(value)) {
    return normalizeNumberFieldValue(value[0], options)
  } else {
    return ""
  }
  if (!raw.trim()) return ""

  // "42%" is the fraction 0.42 (what a Percent field stores) in any number field but Rupiah.
  const pct = /%\s*$/.exec(raw.trim())
  if (pct && !idr) {
    const base = normalizeNumberFieldValue(raw.trim().replace(/%\s*$/, ""), options)
    if (MACHINE_NUMBER.test(base)) return String(Number((Number(base) / 100).toPrecision(15)))
  }

  const { s, neg } = stripCurrency(raw.trim())
  for (const [re, mult] of MULTIPLIERS) {
    if (re.test(s)) {
      const p = parseDigits(s.replace(re, ""), false)
      if (p) {
        const n = Number(`${p.int || "0"}.${p.frac || "0"}`) * mult
        if (Number.isFinite(n) && n < 1e15) {
          const r = idr ? Number(n.toFixed(keep)) : n
          return String(neg && r !== 0 ? -r : r)
        }
      }
    }
  }
  const p = parseDigits(s, idr)
  if (p) {
    p.neg = neg
    const out = idr ? idrFromParsed(p, keep) : plainFromParsed(p)
    if (out !== null) return out
  }
  if (idr) return raw.replace(/\D+/g, "")
  return raw.trim()
}

/** "369000" → "369.000" (id-ID grouping, no currency sign) — for inputs while typing. */
export function groupIdrDigits(digits: string): string {
  const neg = digits.trim().startsWith("-")
  const d = digits.replace(/\D+/g, "")
  if (!d) return ""
  const t = trimZeros(d)
  return (neg ? "-" : "") + t.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

/** A stored Rupiah value (even a legacy "369.000") → "Rp 369.000", "−Rp 25.000"; "" when there is no amount. */
export function formatIdr(value: unknown): string {
  const n = storedNumber(value, "currency-idr")
  return n === null ? "" : formatNumberWith(n, numberOptions("currency-idr"))
}

/**
 * A Rupiah amount for display: "Rp 3.849.000", "−Rp 5.000", a plain space after "Rp", whole rupiah, in
 * every browser and both languages. Intl's own IDR currency style is not used: Safari prints
 * "Rp3.849.000" and Chromium "Rp\u00a03.849.000" (UI tour run 7, 14 Oct 2026).
 */
export function rupiah(n: number): string {
  const r = Math.round(n)
  return `${r < 0 ? MINUS : ""}Rp ${grouped(Math.abs(r), 0, 0)}`
}
