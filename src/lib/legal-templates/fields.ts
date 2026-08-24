// The Legal project's custom fields ARE the document templates' variable slots.
//
// One registry, three consumers:
//   1. the seed script creates these custom fields on the Legal project;
//   2. the intake forms map their inputs into them (mapping.target = "custom_field");
//   3. the generator reads them off the task and turns them into template tokens.
//
// Because the values live on the TASK as custom fields (not buried in FormSubmission.data), legal can
// see and FIX a wrong venue or amount on the board before the document is generated — and the
// document then uses the corrected value. That's the whole point of routing through custom fields.
//
// Matching is by NAME (trimmed, case-insensitive) + TYPE, the same convention the cross-project task
// copy uses, so renaming a field in the UI detaches it deliberately rather than silently mismatching.
//
// The field set follows the templates Bagas supplied on 2026-07-30 — which are NOT the ones the old
// bot used. Two consequences baked in below: the current invoice has **no "B. EXCLUDE" section**, so
// the four exclude quantities are gone; and the MOU's riders/akomodasi/PIHAK KEDUA/durasi are all
// per-deal, so they're fields rather than fixed template text.
import type { CustomFieldType } from "@/generated/prisma/client"
import type { DocumentSeriesKey } from "@/lib/document-numbers"

export type DocKind = "INVOICE" | "CONTRACT" | "MOU"

export type LegalFieldKey =
  | "docType" | "clientCode" | "clientName" | "clientAddress" | "clientNpwp"
  | "picName" | "picTitle" | "picEmail" | "picPhone"
  | "venue" | "eventName" | "eventDate" | "lineItem" | "amount"
  | "invoiceDate" | "paymentTermDays" | "dueDate" | "paymentTerm"
  | "projectName" | "scope"
  | "mouSignDate" | "mouSignCity"
  | "p1Name" | "p1Company" | "p1Title" | "p1Address"
  | "p2Name" | "p2Title" | "p2Address" | "p2Phone" | "p2Account"
  | "talent" | "durationMinutes" | "dpDate" | "settlementDate" | "accommodation" | "riders"
  | "documentNumber"

type LegalField = {
  key: LegalFieldKey
  /** Exact custom-field name created on the Legal project. Changing this is a migration, not an edit. */
  name: string
  type: CustomFieldType
  options?: string[]
  docs: DocKind[]
  required: boolean
  /** Form input type; omitted = not asked on the form (derived or written back by the generator). */
  input?: "text" | "textarea" | "number" | "date" | "select"
  help?: string
}

/**
 * Which document kinds the Legal flow currently offers. Bagas narrowed this to MOU + the new PATS
 * invoice on 2026-07-30 ("selain itu hapus dulu aja"); the PKS template code and its Google Docs
 * master are kept intact, just not offered — putting "CONTRACT" back here re-enables the whole thing.
 *
 * Fields whose `docs` don't intersect this list are never created, and the seed script deletes any
 * that already exist (as long as nobody has typed a value into them).
 */
export const ACTIVE_DOC_KINDS: DocKind[] = ["INVOICE", "MOU"]

// "Invoice PT Jagain Karya Indonesia" is deliberately NOT offered either: there's no Jagain invoice
// master, and printing the PATS entity block on a Jagain invoice is worse than not offering it.
const ALL_DOC_TYPES: { label: string; series: DocumentSeriesKey; kind: DocKind }[] = [
  { label: "Invoice PATS Entertainment", series: "PATS_INVOICE", kind: "INVOICE" },
  { label: "Kontrak / PKS Jagain", series: "JAGAIN_PKS", kind: "CONTRACT" },
  { label: "MOU Event", series: "MOU_EVENT", kind: "MOU" },
]
export const DOC_TYPE_OPTIONS = ALL_DOC_TYPES.filter((o) => ACTIVE_DOC_KINDS.includes(o.kind))

export const LEGAL_FIELDS: LegalField[] = [
  { key: "docType", name: "Jenis Dokumen", type: "SELECT", options: DOC_TYPE_OPTIONS.map((o) => o.label),
    docs: ["INVOICE", "CONTRACT", "MOU"], required: true, input: "select",
    help: "Nentuin template dan seri nomor yang dipakai." },

  // ── Invoice (the 9 slots circled on the sample) ───────────────────────────
  { key: "clientName", name: "Klien / Penerima", type: "TEXT", docs: ["INVOICE", "CONTRACT"], required: true, input: "text",
    help: "Yang dicetak di baris \"To:\". Nama badan hukum klien, persis seperti yang harus tercetak." },
  { key: "venue", name: "Nama Venue / Event", type: "TEXT", docs: ["INVOICE", "MOU"], required: true, input: "text",
    help: "Invoice: isi kolom \"Event\". MOU: tempat acaranya, mis. \"SHELTER Club, Surabaya\"." },
  { key: "eventDate", name: "Tanggal Acara", type: "DATE", docs: ["INVOICE", "MOU"], required: true, input: "date" },
  { key: "lineItem", name: "Item Talent / Jasa", type: "TEXT", docs: ["INVOICE"], required: true, input: "text",
    help: "Baris item di invoice, mis. \"WHOOSH TRANSPORTATION PATS MAFIA\"." },
  { key: "amount", name: "Nominal", type: "NUMBER", docs: ["INVOICE", "CONTRACT", "MOU"], required: true, input: "number",
    help: "Angka aja, tanpa Rp dan tanpa titik. Terbilang digenerate otomatis." },
  { key: "invoiceDate", name: "Tanggal Invoice", type: "DATE", docs: ["INVOICE", "CONTRACT"], required: false, input: "date",
    help: "Kosong = pakai tanggal dokumen digenerate." },
  { key: "paymentTermDays", name: "Syarat Pembayaran (Hari)", type: "NUMBER", docs: ["INVOICE"], required: false, input: "number",
    help: "Kosong = 3 hari, sesuai default template." },
  { key: "dueDate", name: "Tanggal Jatuh Tempo", type: "DATE", docs: ["INVOICE"], required: false, input: "date",
    help: "Kosong = dihitung dari tanggal invoice + syarat pembayaran." },

  // ── Contract / PKS ────────────────────────────────────────────────────────
  { key: "clientCode", name: "Kode Klien", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text",
    help: "Singkatan buat nomor dokumen, mis. JW." },
  { key: "clientAddress", name: "Alamat Klien", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text" },
  { key: "clientNpwp", name: "NPWP Klien", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text",
    help: "Kosongin kalau belum ada — dokumen nulis \"Soft copy menyusul\", bukan angka karangan." },
  { key: "picName", name: "PIC Klien", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text" },
  { key: "picTitle", name: "Jabatan PIC Klien", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text" },
  { key: "picEmail", name: "Email PIC Klien", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text" },
  { key: "picPhone", name: "HP PIC Klien", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text" },
  { key: "projectName", name: "Nama Project", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text" },
  { key: "scope", name: "Scope Pekerjaan", type: "TEXT", docs: ["CONTRACT"], required: false, input: "textarea" },
  { key: "paymentTerm", name: "TOP / Jatuh Tempo", type: "TEXT", docs: ["CONTRACT"], required: false, input: "text",
    help: "Mis. \"90 hari setelah invoice diterima\". Kosong = default template." },

  // ── MOU Event ─────────────────────────────────────────────────────────────
  { key: "mouSignDate", name: "Tanggal Tanda Tangan", type: "DATE", docs: ["MOU"], required: true, input: "date",
    help: "Nama harinya diisi otomatis." },
  { key: "mouSignCity", name: "Kota Tanda Tangan", type: "TEXT", docs: ["MOU"], required: true, input: "text" },
  { key: "eventName", name: "Nama Event", type: "TEXT", docs: ["MOU"], required: true, input: "text",
    help: "Mis. FRIDAZE." },
  { key: "talent", name: "Talent", type: "TEXT", docs: ["MOU"], required: true, input: "text",
    help: "Mis. DJ.BBZ. Dipakai di Pasal 2 dan Pasal 3." },
  { key: "durationMinutes", name: "Durasi Minimal (Menit)", type: "NUMBER", docs: ["MOU"], required: true, input: "number" },
  { key: "dpDate", name: "Tanggal DP (50%)", type: "DATE", docs: ["MOU"], required: true, input: "date" },
  { key: "settlementDate", name: "Tanggal Pelunasan", type: "DATE", docs: ["MOU"], required: true, input: "date",
    help: "Diisi manual — biasanya H-1 sebelum event." },
  { key: "p1Name", name: "PIHAK PERTAMA - Nama", type: "TEXT", docs: ["MOU"], required: true, input: "text" },
  { key: "p1Company", name: "PIHAK PERTAMA - Perusahaan", type: "TEXT", docs: ["MOU"], required: true, input: "text" },
  { key: "p1Title", name: "PIHAK PERTAMA - Jabatan", type: "TEXT", docs: ["MOU"], required: true, input: "text" },
  { key: "p1Address", name: "PIHAK PERTAMA - Alamat", type: "TEXT", docs: ["MOU"], required: false, input: "text" },
  { key: "p2Name", name: "PIHAK KEDUA - Nama", type: "TEXT", docs: ["MOU"], required: true, input: "text" },
  { key: "p2Title", name: "PIHAK KEDUA - Jabatan", type: "TEXT", docs: ["MOU"], required: true, input: "text" },
  { key: "p2Address", name: "PIHAK KEDUA - Alamat", type: "TEXT", docs: ["MOU"], required: false, input: "text" },
  { key: "p2Phone", name: "PIHAK KEDUA - No. Telp", type: "TEXT", docs: ["MOU"], required: false, input: "text" },
  { key: "p2Account", name: "PIHAK KEDUA - No. Rekening", type: "TEXT", docs: ["MOU"], required: true, input: "text",
    help: "Persis seperti yang dicetak, mis. \"0703727899 (BCA) a/n NITA ROSDIYANTI\". Cek dua kali — ini rekening tujuan pembayaran." },
  { key: "accommodation", name: "Fasilitas Akomodasi", type: "TEXT", docs: ["MOU"], required: false, input: "textarea",
    help: "Satu item per baris. Mis. \"2 kamar hotel 1 malam di La Lisa Hotel\"." },
  { key: "riders", name: "Riders", type: "TEXT", docs: ["MOU"], required: false, input: "textarea",
    help: "Satu item per baris. Mis. \"8 bottle Mineral Water\"." },

  // Written back by the generator, never asked on the form — the number comes from the register.
  { key: "documentNumber", name: "Nomor Dokumen", type: "TEXT", docs: ["INVOICE", "CONTRACT"], required: false },
]

export const legalFieldByKey = (key: LegalFieldKey) => LEGAL_FIELDS.find((f) => f.key === key)!

/** Fields the intake form should ask for, for a given document kind. */
export const formFieldsFor = (kind: DocKind) =>
  LEGAL_FIELDS.filter((f) => f.input && f.docs.includes(kind))

export const seriesForDocTypeLabel = (label: string): DocumentSeriesKey | null =>
  DOC_TYPE_OPTIONS.find((o) => o.label === label.trim())?.series ?? null

/** Custom fields that should exist right now — i.e. those an ACTIVE document kind actually uses. */
/**
 * The doc-type choices valid on a form for one kind. Each intake form is per document type, so its
 * "Jenis Dokumen" dropdown must offer only its own — otherwise someone picks "MOU Event" on the
 * invoice form and lands a task tagged MOU with only invoice fields filled, which then fails to
 * generate. The custom field itself still accepts every label.
 */
export const docTypeLabelsFor = (kind: DocKind) =>
  DOC_TYPE_OPTIONS.filter((o) => o.kind === kind).map((o) => o.label)

export const activeLegalFields = () =>
  LEGAL_FIELDS.filter((f) => f.docs.some((d) => ACTIVE_DOC_KINDS.includes(d)))

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Turn a task's custom-field values into a key→value map the templates can use.
 *
 * @param values rows joined with their CustomField, exactly as Prisma returns them.
 */
export function readLegalFields(
  values: { value: string | null; customField: { name: string; type: CustomFieldType } }[],
): Partial<Record<LegalFieldKey, string>> {
  const byName = new Map<string, LegalFieldKey>()
  for (const f of LEGAL_FIELDS) byName.set(`${norm(f.name)}|${f.type}`, f.key)

  const out: Partial<Record<LegalFieldKey, string>> = {}
  for (const v of values) {
    const key = byName.get(`${norm(v.customField.name)}|${v.customField.type}`)
    if (!key) continue
    const val = (v.value ?? "").trim()
    if (val) out[key] = val
  }
  return out
}

/**
 * Check a task has everything its document kind needs, BEFORE a number is allocated — a number spent
 * on a document that then fails validation is a permanent gap in the sequence.
 */
export function missingLegalFields(
  kind: DocKind,
  vals: Partial<Record<LegalFieldKey, string>>,
  series: DocumentSeriesKey,
): string[] {
  const missing = LEGAL_FIELDS
    .filter((f) => f.required && f.docs.includes(kind) && !vals[f.key])
    .map((f) => f.name)
  // The client code only matters for the series that actually print it.
  if (series === "JAGAIN_PKS" && !vals.clientCode) missing.push(legalFieldByKey("clientCode").name)
  return missing
}
