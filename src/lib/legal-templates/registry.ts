// Which Google Docs master belongs to which document series, and how a task's field values become
// that master's tokens.
//
// The invoice master is a TOKENIZED COPY of Bagas's original (2026-07-30) — the original
// 1LMMCO-4pZ6VcT87hrWiUzrMeErNAlCzLpXfhGc2-Kkw is left untouched, per the read-only rule in
// config/invoice_templates.json. The PKS master was seeded from buildPksTemplate().
import { DOCUMENT_SERIES, formatIdr, terbilang, type DocumentSeriesKey } from "@/lib/document-numbers"
import { NPWP_PENDING } from "@/lib/legal-templates/pks"
import type { DocKind, LegalFieldKey } from "@/lib/legal-templates/fields"
import { mouTokens } from "@/lib/legal-templates/mou"

type Vals = Partial<Record<LegalFieldKey, string>>

export type TemplateDef = {
  masterId: string
  /** Set when the series must refuse to generate; shown to the user verbatim. */
  notReadyReason?: string
  kind: DocKind
  /** Filename for the generated copy. */
  fileName: (v: Vals, number: string) => string
  tokens: (v: Vals, ctx: { number: string; docDate: string; dueDate: string }) => Record<string, string>
}

/** Indonesian long date, the format both templates print ("16 Maret 2026"). */
export function idDate(d: Date): string {
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
}

const num = (v?: string) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""))
  return Number.isFinite(n) ? n : 0
}
const dash = (v?: string) => (v && v.trim() ? v.trim() : "-")

export const TEMPLATES: Record<DocumentSeriesKey, TemplateDef> = {
  PATS_INVOICE: {
    // Built from the .docx Bagas sent 2026-07-30, uploaded to Drive as a native Google Doc (Word→Docs
    // keeps the tables and both logos; PDF→Docs destroys them). Correct "Payment To" account, no
    // retired "B. EXCLUDE" section. The previous master (1EyesJSUI…, tokenized from the OLD layout) is
    // superseded — it had no payment block at all.
    masterId: "1SB7yy4WdZYzKR0gL2jbaBX9ExEFEycbZlgh_JXi11jo",
    kind: "INVOICE",
    fileName: (v, n) => `Invoice PATS Entertainment - ${v.clientName ?? "-"} - ${n.replace(/\//g, "-")}`,
    tokens: (v, ctx) => ({
      "{{NOMOR_INVOICE}}": ctx.number,
      "{{TANGGAL_INVOICE}}": ctx.docDate,
      "{{TOP_HARI}}": `${num(v.paymentTermDays) || 3} Hari`,
      "{{TANGGAL_JATUH_TEMPO}}": ctx.dueDate,
      "{{KLIEN}}": dash(v.clientName),
      "{{VENUE}}": dash(v.venue),
      "{{TANGGAL_ACARA}}": v.eventDate ? idDate(new Date(v.eventDate)) : "-",
      "{{ITEM}}": dash(v.lineItem),
      "{{DURASI}}": "60-90",
      "{{NILAI}}": Math.floor(num(v.amount)).toLocaleString("id-ID"),
      "{{TERBILANG}}": terbilang(num(v.amount)).toUpperCase(),
    }),
  },

  // Jagain-billed invoices reuse the PATS layout until a Jagain invoice master is registered. Flagged
  // rather than silently wrong: the printed entity block would say PATS, so this series is gated off
  // in isSeriesReady() below.
  JAGAIN_INVOICE: {
    masterId: "",
    kind: "INVOICE",
    fileName: (v, n) => `Invoice Jagain - ${v.clientName ?? "-"} - ${n.replace(/\//g, "-")}`,
    tokens: (v, ctx) => TEMPLATES.PATS_INVOICE.tokens(v, ctx),
  },

  MOU_EVENT: {
    // Seeded from MOU_TEMPLATE_TEXT; the source MOU is a Word document with no Drive copy at all
    // (searched by name and by content), so this master IS the canonical version now.
    masterId: "1beUq72Y97gqlccPe2t-DlvexdfNKOWzD1s8Jy3F8Lfo",
    kind: "MOU",
    fileName: (v) => `MOU Event - ${v.eventName ?? "-"} - ${v.talent ?? "-"}`,
    tokens: (v) => mouTokens({
      signDate: v.mouSignDate ?? "", signCity: v.mouSignCity ?? "",
      p1Name: dash(v.p1Name), p1Company: dash(v.p1Company), p1Title: dash(v.p1Title),
      p1Address: dash(v.p1Address),
      p2Name: dash(v.p2Name), p2Title: dash(v.p2Title), p2Address: dash(v.p2Address),
      p2Phone: dash(v.p2Phone), p2Account: dash(v.p2Account),
      eventDate: v.eventDate ?? "", eventName: dash(v.eventName), venue: dash(v.venue),
      talent: dash(v.talent), fee: formatIdr(num(v.amount)),
      durationMinutes: String(num(v.durationMinutes) || 90),
      dpDate: v.dpDate ? idDate(new Date(v.dpDate)) : "-",
      settlementDate: v.settlementDate ? idDate(new Date(v.settlementDate)) : "-",
      accommodation: v.accommodation ?? "", riders: v.riders ?? "",
    }),
  },

  JAGAIN_PKS: {
    masterId: "1q9BcnzGoe3irXPnHou-mlcjQ96_0VY0d6jHFgHlSZMA",
    kind: "CONTRACT",
    fileName: (v, n) => `PKS ${v.projectName || v.clientName || "-"} - ${n.replace(/\//g, "-")}`,
    tokens: (v, ctx) => ({
      "{{NOMOR_PKS}}": ctx.number,
      "{{TANGGAL_PKS}}": ctx.docDate,
      "{{PROJECT}}": (v.projectName || v.clientName || "-").toUpperCase(),
      "{{SCOPE}}": dash(v.scope),
      "{{KLIEN}}": dash(v.clientName),
      "{{ALAMAT_KLIEN}}": dash(v.clientAddress),
      "{{PIC_KLIEN}}": dash(v.picName),
      "{{JABATAN_PIC_KLIEN}}": dash(v.picTitle),
      "{{EMAIL_KLIEN}}": dash(v.picEmail),
      "{{HP_KLIEN}}": dash(v.picPhone),
      "{{NPWP_KLIEN}}": v.clientNpwp?.trim() || NPWP_PENDING,
      // A PKS references the invoice it bills against; blank is legitimate when the invoice
      // hasn't been issued yet, so it prints "-" instead of blocking generation.
      "{{NOMOR_INVOICE}}": dash(v.documentNumber),
      "{{TANGGAL_INVOICE}}": v.invoiceDate ? idDate(new Date(v.invoiceDate)) : ctx.docDate,
      "{{NILAI}}": formatIdr(num(v.amount)),
      "{{TERBILANG}}": terbilang(num(v.amount)),
      "{{TOP}}": dash(v.paymentTerm) === "-" ? "90 hari setelah invoice diterima" : v.paymentTerm!.trim(),
    }),
  },
}

/** Series that can't generate yet — say so instead of producing a wrong document. */
export const isSeriesReady = (s: DocumentSeriesKey) =>
  Boolean(TEMPLATES[s].masterId) && !TEMPLATES[s].notReadyReason
export const seriesNotReadyReason = (s: DocumentSeriesKey) =>
  TEMPLATES[s].notReadyReason ?? `Template buat "${DOCUMENT_SERIES[s].label}" belum didaftarin.`

export const seriesLabel = (s: DocumentSeriesKey) => DOCUMENT_SERIES[s].label

/**
 * Values that MUST show up in the filled document, checked by reading the copy back. The number and
 * the client are the two that make a document legally identifiable, so they're never optional.
 */
export function verifyValues(s: DocumentSeriesKey, v: Vals, number: string): string[] {
  const out = number ? [number] : []
  if (TEMPLATES[s].kind === "MOU") {
    // No number to anchor on, so the talent + the payee account are the identifying values.
    return [v.talent, v.p2Account, v.eventName].filter((x): x is string => Boolean(x?.trim()))
  }
  if (v.clientName?.trim()) out.push(v.clientName.trim())
  if (TEMPLATES[s].kind === "INVOICE" && v.venue?.trim()) out.push(v.venue.trim())
  return out
}

/** Literal values from the seed documents that must never survive into a generated one. */
export const STALE_TEMPLATE_VALUES = [
  // invoice seed (the BROTHERHOOD BUNKER instance the 2026-07 master was built from).
  // NOTE: values inside Word text boxes are invisible to the read-back check — the only one left in
  // the invoice master is the "Payment To" block, which is constant, so there's nothing to verify there.
  "PATS/INV/VIII/2025-091", "BROTHERHOOD BUNKER", "02 November 2025", "05 November 2025",
  "01 November 2025", "3.945.500", "WHOOSH TRANSPORTATION PATS MAFIA",
  // MOU seed (the Shelter Club / DJ.BBZ instance) — these must never survive into a generated MOU
  "Helmi Mashudi", "Shelter Club", "DJ.BBZ", "La Lisa Hotel", "7.000.000",
]

export function dueDateFrom(docDate: Date, paymentTerm?: string): Date {
  // "3 Hari" / "90 hari setelah invoice diterima" → take the first number as days. Default 3 days,
  // which is the PATS talent template's own term.
  const days = Number((paymentTerm ?? "").match(/\d+/)?.[0] ?? 3)
  const d = new Date(docDate)
  d.setDate(d.getDate() + (Number.isFinite(days) ? days : 3))
  return d
}
