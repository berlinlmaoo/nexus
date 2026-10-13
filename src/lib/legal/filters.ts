// Legal templates: the {{PLACEHOLDER | filter}} language, field detection rules and value formatting.
// Pure, no imports, so `node src/lib/legal/filters.test.mjs` can load it on its own.
//
// A template writes {{NAME}} where a value goes, optionally piped through filters, left to right:
//   {{TANGGAL_TTD | hari}}                 → Rabu
//   {{TANGGAL_TTD | tanggal}}              → 30 September 2026   (also the default for a date)
//   {{HONOR | angka}}                      → 25.000.000          (also the default for money)
//   {{HONOR | terbilang_rupiah | upper}}   → DUA PULUH LIMA JUTA RUPIAH
// Repeating rows: {{#BARANG}} … {{NAMA_BARANG}} … {{/BARANG}} (a table row or paragraphs).
// A section with no placeholders inside ({{#PAKAI_MATERAI}} … {{/PAKAI_MATERAI}}) is a yes/no switch.

export const FIELD_TYPES = ["text", "longtext", "date", "number", "money", "select", "boolean", "list"] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export const isFieldType = (v: unknown): v is FieldType => typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v)

export type TemplateField = {
  name: string
  label: string
  type: FieldType
  required: boolean
  help?: string
  /** select only */
  options?: string[]
  /** list only: the fields of one row */
  columns?: TemplateField[]
}

/** Filled by the server, never asked in the form. */
export const AUTO_FIELDS = ["NOMOR", "NAMA_PERUSAHAAN", "PT_PERUSAHAAN", "ALAMAT_PERUSAHAAN", "KODE_PERUSAHAAN"] as const
/** Asked in every form (it decides the number's month and year); a template may print it. */
export const DOC_DATE_FIELD = "TANGGAL_DOKUMEN"

export const isAutoField = (name: string) => (AUTO_FIELDS as readonly string[]).includes(name)

// ── Tags ────────────────────────────────────────────────────────────────────────────────────────────

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/

export type ParsedTag = { name: string; filters: string[] }

/** "TGL | hari | upper" → { name: "TGL", filters: ["hari", "upper"] }. Null when the name is not valid. */
export function parseTag(raw: string): ParsedTag | null {
  const [head, ...rest] = raw.split("|").map((s) => s.trim())
  if (!head || !NAME.test(head)) return null
  return { name: head, filters: rest.map((f) => f.toLowerCase()).filter(Boolean) }
}

const DATE_FILTERS = ["hari", "tanggal", "tgl", "tgl_terbilang", "bulan", "bulan_romawi", "tahun", "tahun_terbilang", "dmy"]
const MONEY_FILTERS = ["rupiah", "angka", "terbilang", "terbilang_rupiah"]
const TEXT_FILTERS = ["upper", "lower", "title"]
export const FILTERS = [...DATE_FILTERS, ...MONEY_FILTERS, ...TEXT_FILTERS]

export function unknownFilters(filters: string[]): string[] {
  return filters.filter((f) => !FILTERS.includes(f))
}

/** "NAMA_PIHAK_KEDUA" → "Nama Pihak Kedua" */
export function humanizeFieldName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^[A-Z]+$/.test(w) && ["KTP", "NIK", "NPWP", "PT", "PIC", "WA", "SPK", "PKS", "NDA", "MOU", "TTD", "HQ"].includes(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
}

/** The type a field most likely has, from how the template uses it and then from its name. */
export function inferFieldType(name: string, filters: string[]): FieldType {
  if (filters.some((f) => DATE_FILTERS.includes(f))) return "date"
  if (filters.some((f) => f === "rupiah" || f === "terbilang_rupiah")) return "money"
  if (filters.some((f) => f === "angka" || f === "terbilang")) return "number"
  const n = name.toUpperCase()
  if (/(^|_)(TANGGAL|TGL)(_|$)/.test(n)) return "date"
  if (/(NILAI|HARGA|HONOR|FEE|BIAYA|NOMINAL|TOTAL|DENDA|UPAH|GAJI)/.test(n)) return "money"
  if (/(^|_)(JUMLAH|QTY|DURASI|PERSEN)(_|$)/.test(n)) return "number"
  if (/(ALAMAT|KETERANGAN|DESKRIPSI|RINCIAN|LINGKUP|URAIAN|CATATAN|WEWENANG|DASAR|KRONOLOGI)/.test(n)) return "longtext"
  return "text"
}

/** Keep what people set on a field (label, type, required, help, options) across a new template version. */
export function carryOverFields(detected: TemplateField[], previous: TemplateField[]): TemplateField[] {
  const prev = new Map(previous.map((f) => [f.name, f]))
  return detected.map((f) => {
    const p = prev.get(f.name)
    if (!p) return f
    const merged: TemplateField = { ...f, label: p.label, required: p.required, help: p.help }
    // A list stays a list (its shape comes from the file); a scalar keeps the type someone chose.
    if (f.type !== "list" && p.type !== "list") merged.type = p.type
    if (p.options) merged.options = p.options
    if (f.columns) merged.columns = carryOverFields(f.columns, p.columns ?? [])
    return merged
  })
}

// ── Values ──────────────────────────────────────────────────────────────────────────────────────────

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]

/** "2026-09-30" (what the form sends) → its parts; null when it isn't a real date. */
export function parseIsoDate(v: unknown): { y: number; m: number; d: number; weekday: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return { y, m: mo, d, weekday: date.getUTCDay() }
}

/** "25.000.000", "25000000", "Rp 25.000.000,00" → 25000000. Null when there is no number. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  let s = String(v ?? "").replace(/rp\.?/i, "").replace(/\s/g, "")
  if (!/\d/.test(s)) return null
  // A plain number ("1250000.5", what a number input sends) as is; "25,000,000" (English) has 3-digit groups
  // after each comma; anything else is Indonesian: "." thousands, "," decimals.
  if (/^-?\d+(\.\d{1,2})?$/.test(s)) return Number(s)
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "")
  else s = s.replace(/\./g, "").replace(",", ".")
  const n = Number(s.replace(/[^\d.-]/g, ""))
  return Number.isFinite(n) ? n : null
}

export const formatThousands = (n: number) => {
  const [int, dec] = Math.abs(n).toFixed(2).split(".")
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${n < 0 ? "-" : ""}${grouped}${dec !== "00" ? `,${dec}` : ""}`
}

const ONES = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"]

function spell(n: number): string {
  if (n < 12) return ONES[n]
  if (n < 20) return `${ONES[n - 10]} belas`
  if (n < 100) {
    const rest = n % 10
    return `${ONES[Math.floor(n / 10)]} puluh${rest ? ` ${ONES[rest]}` : ""}`
  }
  if (n < 200) return `seratus${n % 100 ? ` ${spell(n % 100)}` : ""}`
  if (n < 1000) {
    const rest = n % 100
    return `${ONES[Math.floor(n / 100)]} ratus${rest ? ` ${spell(rest)}` : ""}`
  }
  if (n < 2000) return `seribu${n % 1000 ? ` ${spell(n % 1000)}` : ""}`
  for (const [limit, name] of [[1e12, "triliun"], [1e9, "miliar"], [1e6, "juta"], [1e3, "ribu"]] as const) {
    if (n >= limit) {
      const rest = n % limit
      return `${spell(Math.floor(n / limit))} ${name}${rest ? ` ${spell(rest)}` : ""}`
    }
  }
  return String(n)
}

/** `12` → `"dua belas"`; 0 → `"nol"`. Lower case, no currency; the fraction is dropped. */
export function terbilangWords(amount: number): string {
  const n = Math.floor(Math.abs(amount))
  return n === 0 ? "nol" : spell(n).replace(/\s+/g, " ").trim()
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])\p{Ll}/gu, (m) => m.toUpperCase())

/** `600000000` → `"Enam Ratus Juta Rupiah"` — Title Case, as the templates print it. */
export function terbilangRupiah(amount: number): string {
  return titleCase(`${terbilangWords(amount)} rupiah`)
}

/** One field value as printed, before filters: what a placeholder without filters shows. */
export function displayValue(type: FieldType | undefined, v: unknown): string {
  if (v == null) return ""
  if (type === "date") {
    const d = parseIsoDate(v)
    return d ? `${d.d} ${BULAN[d.m - 1]} ${d.y}` : String(v)
  }
  if (type === "money") {
    const n = parseAmount(v)
    return n == null ? String(v) : formatThousands(n)
  }
  if (type === "boolean") return v === true || v === "true" ? "Ya" : ""
  return String(v)
}

export class FilterError extends Error {}

/** Apply one filter. Date and money filters read the raw value; text filters the text so far. */
export function applyFilter(filter: string, current: string, raw: unknown): string {
  const date = () => {
    const d = parseIsoDate(raw)
    if (!d) throw new FilterError(`"${filter}" needs a date`)
    return d
  }
  const amount = () => {
    const n = parseAmount(raw)
    if (n == null) throw new FilterError(`"${filter}" needs a number`)
    return n
  }
  switch (filter) {
    case "hari": return HARI[date().weekday]
    case "tanggal": { const d = date(); return `${d.d} ${BULAN[d.m - 1]} ${d.y}` }
    case "tgl": return String(date().d)
    case "tgl_terbilang": return terbilangWords(date().d)
    case "bulan": return BULAN[date().m - 1]
    case "bulan_romawi": return ROMAWI[date().m - 1]
    case "tahun": return String(date().y)
    case "tahun_terbilang": return titleCase(terbilangWords(date().y))
    case "dmy": { const d = date(); return `${String(d.d).padStart(2, "0")}-${String(d.m).padStart(2, "0")}-${d.y}` }
    case "rupiah": return `Rp ${formatThousands(amount())}`
    case "angka": return formatThousands(amount())
    case "terbilang": return terbilangWords(amount())
    case "terbilang_rupiah": return terbilangRupiah(amount())
    case "upper": return current.toUpperCase()
    case "lower": return current.toLowerCase()
    case "title": return titleCase(current)
    default: throw new FilterError(`Unknown filter "${filter}"`)
  }
}

export function renderTagValue(tag: ParsedTag, raw: unknown, type: FieldType | undefined): string {
  let out = displayValue(type, raw)
  if (raw == null || raw === "") return out
  for (const f of tag.filters) out = applyFilter(f, out, raw)
  return out
}

/**
 * Apply what someone changed in the field editor to a version's detected fields. Only the presentation
 * changes (label, type, required, help, options); which fields exist and which are lists comes from the
 * file and can't be edited here — that is a new version.
 */
export function applyFieldEdits(current: TemplateField[], edited: unknown): TemplateField[] {
  const byName = new Map<string, Record<string, unknown>>()
  if (Array.isArray(edited)) {
    for (const e of edited) {
      if (e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string") byName.set((e as { name: string }).name, e as Record<string, unknown>)
    }
  }
  return current.map((f) => {
    const e = byName.get(f.name)
    if (!e) return f
    const next: TemplateField = { ...f }
    if (typeof e.label === "string" && e.label.trim()) next.label = e.label.trim().slice(0, 120)
    if (typeof e.required === "boolean") next.required = f.name === DOC_DATE_FIELD ? true : e.required
    if (typeof e.help === "string") next.help = e.help.trim().slice(0, 300) || undefined
    const scalar = f.type !== "list" && f.type !== "boolean"
    if (scalar && isFieldType(e.type) && e.type !== "list" && e.type !== "boolean" && f.name !== DOC_DATE_FIELD) next.type = e.type
    if (next.type === "select") {
      const opts = Array.isArray(e.options) ? e.options : f.options ?? []
      next.options = [...new Set(opts.filter((o): o is string => typeof o === "string").map((o) => o.trim().slice(0, 120)).filter(Boolean))].slice(0, 50)
    } else {
      delete next.options
    }
    if (f.columns) next.columns = applyFieldEdits(f.columns, e.columns)
    return next
  })
}

// ── Form values ─────────────────────────────────────────────────────────────────────────────────────

export type FormValues = Record<string, unknown>
export type FieldErrors = Record<string, string>

const MAX_TEXT = 5000
const MAX_LONGTEXT = 20000
const MAX_ROWS = 200

const isEmpty = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)

/**
 * Check and normalize what a form sent, before anything is allocated: dates as YYYY-MM-DD, amounts as
 * numbers, lists as rows of their columns (empty rows dropped). Unknown keys are dropped. Errors are keyed by
 * field name ("BARANG.2.NAMA_BARANG" for a cell).
 */
export function validateFormValues(fields: TemplateField[], input: unknown, prefix = ""): { values: FormValues; errors: FieldErrors } {
  const src = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  const values: FormValues = {}
  const errors: FieldErrors = {}
  for (const f of fields) {
    const key = `${prefix}${f.name}`
    const raw = src[f.name]
    if (f.type === "list") {
      const rows = Array.isArray(raw) ? raw : []
      if (rows.length > MAX_ROWS) { errors[key] = `At most ${MAX_ROWS} rows`; continue }
      const out: FormValues[] = []
      rows.forEach((row) => {
        const cells = row && typeof row === "object" ? (row as Record<string, unknown>) : {}
        if ((f.columns ?? []).every((c) => isEmpty(cells[c.name]) || cells[c.name] === false)) return
        const r = validateFormValues(f.columns ?? [], cells, `${key}.${out.length}.`)
        Object.assign(errors, r.errors)
        out.push(r.values)
      })
      if (f.required && out.length === 0) errors[key] = "Add at least one row"
      values[f.name] = out
      continue
    }
    if (f.type === "boolean") {
      values[f.name] = raw === true || raw === "true"
      continue
    }
    if (isEmpty(raw)) {
      if (f.required) errors[key] = "Required"
      continue
    }
    const s = String(raw).trim()
    switch (f.type) {
      case "date":
        if (!parseIsoDate(s)) errors[key] = "Not a valid date"
        else values[f.name] = s.slice(0, 10)
        break
      case "number":
      case "money": {
        const n = parseAmount(s)
        if (n == null) errors[key] = "Not a number"
        else values[f.name] = n
        break
      }
      case "select":
        if (f.options?.length && !f.options.includes(s)) errors[key] = "Pick one of the choices"
        else values[f.name] = s
        break
      case "longtext":
        values[f.name] = s.slice(0, MAX_LONGTEXT)
        break
      default:
        values[f.name] = s.slice(0, MAX_TEXT)
    }
  }
  return { values, errors }
}
