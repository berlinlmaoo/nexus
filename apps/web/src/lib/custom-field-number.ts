// Number custom fields as people in Indonesia type them.
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
// fraction. One or two digits after the last separator ("150.000,50") are cents and are rounded.
//
// Self-contained on purpose (no imports): this exact file is also
// apps/web/src/lib/custom-field-number.ts — keep the two copies identical
// (src/lib/custom-field-number.test.mjs checks).

import { formatRupiah } from "./number-format.ts"

export type NumberFieldFormat = "plain" | "currency-idr"

const IDR_FORMAT = /^(currency-idr|idr|rupiah)$/i

/** The display format of a NUMBER field from its options ({ format: "currency-idr" } or the bare string). */
export function numberFieldFormat(options: unknown): NumberFieldFormat {
  const f =
    typeof options === "string"
      ? options
      : options && typeof options === "object" && !Array.isArray(options)
        ? (options as { format?: unknown }).format
        : undefined
  return typeof f === "string" && IDR_FORMAT.test(f.trim()) ? "currency-idr" : "plain"
}

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
  s = s.replace(/^(?:rp\.?|idr)/i, "")
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

function idrFromParsed(p: Parsed): string {
  let int = trimZeros(p.int || "0")
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
  const idr = numberFieldFormat(options) === "currency-idr"
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

  const { s, neg } = stripCurrency(raw.trim())
  for (const [re, mult] of MULTIPLIERS) {
    if (re.test(s)) {
      const p = parseDigits(s.replace(re, ""), false)
      if (p) {
        const n = Number(`${p.int || "0"}.${p.frac || "0"}`) * mult
        if (Number.isFinite(n) && n < 1e15) {
          const r = idr ? Math.round(n) : n
          return String(neg && r !== 0 ? -r : r)
        }
      }
    }
  }
  const p = parseDigits(s, idr)
  if (p) {
    p.neg = neg
    const out = idr ? idrFromParsed(p) : plainFromParsed(p)
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

/** A stored Rupiah value (even a legacy "369.000") → "Rp 369.000"; "" when there is no amount. */
export function formatIdr(value: unknown): string {
  const n = normalizeNumberFieldValue(value, "currency-idr")
  if (!n) return ""
  const neg = n.startsWith("-")
  return `${neg ? "-" : ""}Rp ${groupIdrDigits(n.replace("-", ""))}`
}

/**
 * A Rupiah amount for display: "Rp 3.849.000", a plain space after "Rp", in every browser and both
 * languages. Intl's own IDR currency style is not used: Safari prints "Rp3.849.000" and Chromium
 * "Rp\u00a03.849.000" (UI tour run 7, 14 Oct 2026: the phone web showed "Rp3.849.000" while every other
 * screen read "Rp 3.849.000").
 */
export function rupiah(n: number): string {
  return formatRupiah(n)
}
