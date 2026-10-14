// Legal templates: the {{PLACEHOLDER | filter}} language, field detection rules and value formatting.
// Pure, no imports, so `node src/lib/legal/filters.test.mjs` can load it on its own.
//
// A template writes {{NAME}} where a value goes, optionally piped through filters, left to right:
//   {{TANGGAL_TTD | hari}}                 → Rabu
//   {{TANGGAL_TTD | tanggal}}              → 30 September 2026   (also the default for a date)
//   {{HONOR | rupiah}}                     → Rp. 25.000.000,00   (how every amount in a document is written)
//   {{HONOR | angka}}                      → 25.000.000          (also the default for money)
//   {{HONOR | terbilang_rupiah | upper}}   → DUA PULUH LIMA JUTA RUPIAH
//   {{TINGKAT | urutan}}                   → Kedua                (I / II / 2 → the ordinal in words)
// Repeating rows: {{#BARANG}} … {{NAMA_BARANG}} … {{/BARANG}} (a table row or paragraphs).
// A section with no placeholders inside ({{#PAKAI_MATERAI}} … {{/PAKAI_MATERAI}}) is a yes/no switch.
// A section that prints its own field ({{#NPWP}}, NPWP {{NPWP}}{{/NPWP}}) shows only when that field has a
// value; empty or just a dash ("-") hides it, and the field becomes optional.
//
// Computed values: a filter with an argument works out a new value, and the filters after it see that value.
//   {{HONOR | persen:50}}                          → 50% of HONOR                    (6.250.000)
//   {{HONOR | persen:50 | rupiah}}                 → Rp. 6.250.000,00
//   {{NILAI_TERMIN | persen_dari:NILAI_LISENSI}}   → NILAI_TERMIN as % of NILAI_LISENSI (16,67)
//   {{TANGGAL_DOKUMEN | tambah_bulan:DURASI_BULAN}} → the date DURASI_BULAN months on (also tambah_bulan:6)
//   {{KALENDER | jumlah:JUMLAH_EVENT}}             → the sum of one column of a list
// A field named as an argument is asked in the form like any other.

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

/** Filled by the server, never asked in the form. The *_INDUK ones and KE only on an addendum: they describe
 *  the signed document it amends (KE = "Pertama", "Kedua", … for ADD-1, ADD-2, …). */
export const AUTO_FIELDS = [
  "NOMOR", "NAMA_PERUSAHAAN", "PT_PERUSAHAAN", "ALAMAT_PERUSAHAAN", "KODE_PERUSAHAAN",
  "NOMOR_INDUK", "JENIS_DOKUMEN_INDUK", "JUDUL_INDUK", "TANGGAL_INDUK", "KE",
] as const
/** Asked in every form (it decides the number's month and year); a template may print it. */
export const DOC_DATE_FIELD = "TANGGAL_DOKUMEN"

export const isAutoField = (name: string) => (AUTO_FIELDS as readonly string[]).includes(name)

// ── Tags ────────────────────────────────────────────────────────────────────────────────────────────

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/

export type ParsedTag = { name: string; filters: string[] }

/** "TGL | hari | upper" → { name: "TGL", filters: ["hari", "upper"] }. Null when the name is not valid. A filter's
 *  name is lower-cased, its argument kept as written ("persen_dari:NILAI_LISENSI"). */
export function parseTag(raw: string): ParsedTag | null {
  const [head, ...rest] = raw.split("|").map((s) => s.trim())
  if (!head || !NAME.test(head)) return null
  const filters = rest.filter(Boolean).map((f) => {
    const { name, arg } = splitFilter(f)
    return arg === null ? name : `${name}:${arg}`
  })
  return { name: head, filters }
}

/** "persen_dari: NILAI_LISENSI" → { name: "persen_dari", arg: "NILAI_LISENSI" }; no colon → arg null. */
export function splitFilter(filter: string): { name: string; arg: string | null } {
  const i = filter.indexOf(":")
  if (i < 0) return { name: filter.trim().toLowerCase(), arg: null }
  return { name: filter.slice(0, i).trim().toLowerCase(), arg: filter.slice(i + 1).trim() }
}

const DATE_FILTERS = ["hari", "tanggal", "tgl", "tgl_terbilang", "bulan", "bulan_romawi", "tahun", "tahun_terbilang", "dmy"]
const MONEY_FILTERS = ["rupiah", "angka", "terbilang", "terbilang_rupiah"]
const TEXT_FILTERS = ["upper", "lower", "title", "urutan"]
/** Filters that compute a new value, and what their argument is. */
const COMPUTED_FILTERS: Record<string, "number" | "field" | "field-or-number"> = {
  persen: "number",
  persen_dari: "field",
  tambah_bulan: "field-or-number",
  jumlah: "field",
}
export const FILTERS = [...DATE_FILTERS, ...MONEY_FILTERS, ...TEXT_FILTERS, ...Object.keys(COMPUTED_FILTERS)]

const NUMBER_ARG = /^-?\d+([.,]\d+)?$/

/** The filters that don't exist, or whose argument is missing or of the wrong kind. */
export function unknownFilters(filters: string[]): string[] {
  return filters.filter((f) => {
    const { name, arg } = splitFilter(f)
    const kind = COMPUTED_FILTERS[name]
    if (!kind) return !FILTERS.includes(name) || arg !== null
    if (!arg) return true
    if (kind === "number") return !NUMBER_ARG.test(arg)
    if (kind === "field") return !NAME.test(arg)
    return !NAME.test(arg) && !/^-?\d+$/.test(arg)
  })
}

/** Form fields that filters name as their argument ("persen_dari:NILAI_LISENSI" → NILAI_LISENSI). A list's
 *  column (jumlah) is not one. */
export function filterFieldRefs(filters: string[]): string[] {
  const out: string[] = []
  for (const f of filters) {
    const { name, arg } = splitFilter(f)
    if (!arg || !NAME.test(arg)) continue
    if (name === "persen_dari" || name === "tambah_bulan") out.push(arg)
  }
  return out
}

/** A value that counts as given for a {{#FIELD}}…{{/FIELD}} section: not empty and not just a dash. */
export function hasPrintableValue(v: unknown): boolean {
  if (v == null || v === false) return false
  if (Array.isArray(v)) return v.length > 0
  return !/^[\s\-–—]*$/.test(String(v))
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
  // Only the filters that read the field itself: after a computed one, they read the computed value.
  const own: string[] = []
  for (const f of filters) {
    const n = splitFilter(f).name
    if (n === "tambah_bulan") return "date"
    if (n === "persen" || n === "persen_dari") return /(NILAI|HARGA|HONOR|FEE|BIAYA|NOMINAL|TOTAL|DENDA|UPAH|GAJI)/.test(name.toUpperCase()) ? "money" : "number"
    if (n in COMPUTED_FILTERS) break
    own.push(n)
  }
  filters = own
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

/**
 * `6250000` → `"Rp. 6.250.000,00"`: the one way a Legal document writes an amount (owner, 14 Oct 2026). Always
 * two decimals; the forms and the rest of the app keep their own "Rp 6.250.000".
 */
export const formatRupiah = (n: number) => {
  const [int, dec] = Math.abs(n).toFixed(2).split(".")
  return `${n < 0 ? "-" : ""}Rp. ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`
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

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 }

/** "III" → 3, "iv" → 4; null when it isn't a roman numeral up to 399. */
export function romanValue(s: string): number | null {
  const t = s.trim().toUpperCase()
  if (!/^[IVXLC]+$/.test(t)) return null
  let n = 0
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN[t[i]]
    const next = ROMAN[t[i + 1]] ?? 0
    n += v < next ? -v : v
  }
  const back = ["C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"].reduce(
    (acc, sym) => {
      const val = { C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 }[sym]!
      while (acc.n >= val) { acc.s += sym; acc.n -= val }
      return acc
    },
    { n, s: "" },
  ).s
  return n > 0 && back === t ? n : null
}

const URUTAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"]

/**
 * `{{TINGKAT | urutan}}`: a level written as a roman numeral or a number, in words as Indonesian letters print
 * it — "I" → "Pertama", "II" → "Kedua", "III" → "Ketiga", "12" → "Kedua Belas". Anything else prints as is.
 */
export function ordinalText(current: string): string {
  const t = current.trim()
  const n = /^\d+$/.test(t) ? Number(t) : romanValue(t)
  if (!n || n > 99) return current
  if (n === 1) return "Pertama"
  const words = n < 12 ? URUTAN[n] : n < 20 ? `${URUTAN[n - 10]} belas` : `${URUTAN[Math.floor(n / 10)]} puluh${n % 10 ? ` ${URUTAN[n % 10]}` : ""}`
  return titleCase(`ke${words}`)
}

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
    case "rupiah": return formatRupiah(amount())
    case "angka": return formatThousands(amount())
    case "terbilang": return terbilangWords(amount())
    case "terbilang_rupiah": return terbilangRupiah(amount())
    case "upper": return current.toUpperCase()
    case "lower": return current.toLowerCase()
    case "title": return titleCase(current)
    case "urutan": return ordinalText(current)
    default: throw new FilterError(`Unknown filter "${filter}"`)
  }
}

/** The value of another form field, for a filter's argument. */
export type FieldLookup = (name: string) => unknown

/** "2026-01-31" + 1 month → "2026-02-28": a day the next month doesn't have becomes its last day. */
export function addMonths(iso: string, months: number): string | null {
  const d = parseIsoDate(iso)
  if (!d) return null
  const total = d.y * 12 + (d.m - 1) + months
  const y = Math.floor(total / 12)
  const m = total - y * 12 + 1
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(Math.min(d.d, last))}`
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** A computed filter's result: the new value (what later filters read) and how it prints. Null: not one. */
function computeFilter(filter: string, raw: unknown, lookup: FieldLookup): { value: unknown; text: string } | null {
  const { name, arg } = splitFilter(filter)
  if (!(name in COMPUTED_FILTERS) || arg == null) return null
  const amount = (v: unknown, what: string) => {
    const n = parseAmount(v)
    if (n == null) throw new FilterError(`"${name}" needs ${what} as a number`)
    return n
  }
  switch (name) {
    case "persen": {
      const n = round2((amount(raw, "the value") * Number(arg.replace(",", "."))) / 100)
      return { value: n, text: formatThousands(n) }
    }
    case "persen_dari": {
      const whole = amount(lookup(arg), arg)
      if (whole === 0) throw new FilterError(`"${name}": ${arg} is 0`)
      const n = round2((amount(raw, "the value") / whole) * 100)
      return { value: n, text: formatThousands(n) }
    }
    case "tambah_bulan": {
      const months = /^-?\d+$/.test(arg) ? Number(arg) : amount(lookup(arg), arg)
      if (!Number.isInteger(months) || Math.abs(months) > 1200) throw new FilterError(`"${name}" needs a whole number of months`)
      const iso = addMonths(String(raw ?? ""), months)
      if (!iso) throw new FilterError(`"${name}" needs a date`)
      return { value: iso, text: displayValue("date", iso) }
    }
    case "jumlah": {
      if (!Array.isArray(raw)) throw new FilterError(`"${name}" needs a list`)
      const n = round2(raw.reduce((sum: number, row) => sum + (parseAmount((row as Record<string, unknown> | null)?.[arg]) ?? 0), 0))
      return { value: n, text: formatThousands(n) }
    }
  }
  return null
}

export function renderTagValue(tag: ParsedTag, raw: unknown, type: FieldType | undefined, lookup: FieldLookup = () => undefined): string {
  let out = displayValue(type, raw)
  if (raw == null || raw === "") return out
  let value: unknown = raw
  for (const f of tag.filters) {
    const computed = computeFilter(f, value, lookup)
    if (computed) {
      value = computed.value
      out = computed.text
    } else {
      out = applyFilter(f, out, value)
    }
  }
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
