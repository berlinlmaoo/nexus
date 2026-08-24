// Document numbering for the Legal request flow (invoice / PKS).
//
// The formats below are not invented — they're the ones PATS/Jagain already use on real documents,
// lifted from the existing HR-Finance templates so a NEXUS-generated number is indistinguishable
// from a hand-written one:
//
//   PATS talent invoice   PATS/INV/VII/2026-001        seq resets monthly
//   Jagain invoice        INV/JW/PTJKI/VII/2026/001     JW = client code
//   Jagain PKS/contract   PKS/JW/PTJKI/VII/2026/001     JW = client code
//
// The counter is per (series, month) — NOT per client. Two different clients billed in the same month
// take 001 and 002, which is what keeps a monthly register readable and gap-free.
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"

const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const

export type DocumentSeriesKey = "PATS_INVOICE" | "JAGAIN_INVOICE" | "JAGAIN_PKS" | "MOU_EVENT"

type SeriesDef = {
  label: string
  kind: "INVOICE" | "CONTRACT" | "MOU"
  /**
   * Whether the printed number restarts at 1 each MONTH or each YEAR.
   *
   * MONTH is Bagas's decision, **re-confirmed on 2026-07-30 after** he was shown the counter-evidence
   * from his own documents (PATS/INV/III/2026-012 in March → 2026-047 in April → 2025-091 in August,
   * which a monthly reset can't produce). So NEXUS-issued numbers will not continue that historical
   * run — that is intended, not a bug. Kept as a per-series switch in case it's revisited.
   */
  resetPeriod: "MONTH" | "YEAR"
  /** MOU Event carries NO number — the source document prints none anywhere. Don't invent one. */
  numbered: boolean
  /** Legal entity that issues the document, as printed. */
  entity: string
  /** True when the printed number carries a {KLIEN} segment, so the caller must supply one. */
  needsClientCode: boolean
  format: (p: { roman: string; year: number; seq: string; clientCode: string }) => string
}

export const DOCUMENT_SERIES: Record<DocumentSeriesKey, SeriesDef> = {
  PATS_INVOICE: {
    label: "Invoice PATS Entertainment",
    kind: "INVOICE",
    resetPeriod: "MONTH",
    numbered: true,
    entity: "PT PATS DARI SELATAN",
    needsClientCode: false,
    format: ({ roman, year, seq }) => `PATS/INV/${roman}/${year}-${seq}`,
  },
  JAGAIN_INVOICE: {
    label: "Invoice PT Jagain Karya Indonesia",
    kind: "INVOICE",
    resetPeriod: "MONTH",
    numbered: true,
    entity: "PT. Jagain Karya Indonesia",
    needsClientCode: true,
    format: ({ roman, year, seq, clientCode }) => `INV/${clientCode}/PTJKI/${roman}/${year}/${seq}`,
  },
  JAGAIN_PKS: {
    label: "Perjanjian Kerja Sama (PKS)",
    kind: "CONTRACT",
    resetPeriod: "MONTH",
    numbered: true,
    entity: "PT. Jagain Karya Indonesia",
    needsClientCode: true,
    format: ({ roman, year, seq, clientCode }) => `PKS/${clientCode}/PTJKI/${roman}/${year}/${seq}`,
  },
  MOU_EVENT: {
    label: "MOU Event",
    kind: "MOU",
    resetPeriod: "YEAR",
    numbered: false, // the source MOU prints no number at all
    entity: "-",
    needsClientCode: false,
    format: () => "",
  },
}

export const isDocumentSeries = (v: string): v is DocumentSeriesKey => v in DOCUMENT_SERIES

/**
 * Client code as it appears inside a document number: uppercase letters/digits only, so a name like
 * "Johnnie Walker" becomes "JW" only if the requester types it that way — we never guess an
 * abbreviation, we just strip what can't legally appear between the slashes.
 */
export function normalizeClientCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)
}

export type IssuedNumber = {
  id: string
  number: string
  series: DocumentSeriesKey
  seq: number
  year: number
  month: number
}

/**
 * Allocate the next number in a series and record it. Call this INSIDE the transaction that produces
 * the document, so the register and the document can't disagree.
 *
 * The advisory lock serializes concurrent allocations for the same series+month (same pattern as the
 * XP award path in gamification.ts); the unique index on (series, year, month, seq) is the backstop
 * if a caller ever forgets the lock.
 */
export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  opts: {
    series: DocumentSeriesKey
    issuedById: string
    clientCode?: string
    subject?: string
    taskId?: string | null
    /** Defaults to now; pass the document's own date so a back-dated document lands in its own month. */
    at?: Date
  },
): Promise<IssuedNumber> {
  const def = DOCUMENT_SERIES[opts.series]
  const clientCode = normalizeClientCode(opts.clientCode ?? "")
  if (def.needsClientCode && !clientCode) {
    throw new Error(`Series ${opts.series} butuh kode klien (mis. "JW") buat nomor dokumennya.`)
  }

  const at = opts.at ?? new Date()
  const year = at.getFullYear()
  const month = at.getMonth() + 1

  if (!def.numbered) throw new Error(`Series ${opts.series} nggak pakai nomor dokumen.`)

  // Scope of the counter: the month for MONTH series, the whole year for YEAR series.
  const scope = def.resetPeriod === "YEAR" ? { series: opts.series, year } : { series: opts.series, year, month }
  // One waiter at a time per counter scope.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`docnum|${opts.series}|${year}|${def.resetPeriod === "YEAR" ? "Y" : month}`})::int8)`

  const last = await tx.documentNumber.findFirst({
    where: scope,
    orderBy: { seq: "desc" },
    select: { seq: true },
  })
  const seq = (last?.seq ?? 0) + 1

  const number = def.format({
    roman: ROMAN_MONTHS[month - 1],
    year,
    seq: String(seq).padStart(3, "0"),
    clientCode,
  })

  const row = await tx.documentNumber.create({
    data: {
      series: opts.series,
      year,
      month,
      seq,
      number,
      clientCode: clientCode || null,
      subject: opts.subject?.slice(0, 200) || null,
      taskId: opts.taskId ?? null,
      issuedById: opts.issuedById,
    },
    select: { id: true, number: true, seq: true, year: true, month: true },
  })
  return { ...row, series: opts.series }
}

/**
 * What the NEXT number would look like, without taking it. For showing "nomor berikutnya: …" in the
 * UI — never store this, it goes stale the moment someone else generates a document.
 */
export async function peekNextNumber(series: DocumentSeriesKey, clientCode = "", at = new Date()) {
  const def = DOCUMENT_SERIES[series]
  const year = at.getFullYear()
  const month = at.getMonth() + 1
  const last = await prisma.documentNumber.findFirst({
    where: def.resetPeriod === "YEAR" ? { series, year } : { series, year, month },
    orderBy: { seq: "desc" },
    select: { seq: true },
  })
  return def.format({
    roman: ROMAN_MONTHS[month - 1],
    year,
    seq: String((last?.seq ?? 0) + 1).padStart(3, "0"),
    clientCode: normalizeClientCode(clientCode) || "____",
  })
}

// ── Terbilang (amount in words) ────────────────────────────────────────────────
// Invoices and contracts both print the amount twice: as digits and spelled out. Generating it
// removes the most common manual typo on these documents (digits updated, words left stale).
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

/** `600000000` → `"Enam Ratus Juta Rupiah"` — Title Case, matching how the templates print it. */
export function terbilang(amount: number): string {
  const n = Math.floor(Math.abs(amount))
  if (n === 0) return "Nol Rupiah"
  const words = `${spell(n)} rupiah`.replace(/\s+/g, " ").trim()
  return words.replace(/(^|\s)\p{Ll}/gu, (m) => m.toUpperCase())
}

/** `600000000` → `"Rp 600.000.000"` */
export const formatIdr = (amount: number) =>
  `Rp ${Math.floor(Math.abs(amount)).toLocaleString("id-ID")}`
