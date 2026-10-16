import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { addendumNumber, jakartaYearMonth, pickSeq, renderNumber } from "@/lib/legal/rules"

// Legal document numbers: one DocumentNumber row per number actually issued, sequential per series with no
// gaps (owner, 14 Oct 2026). The counter restarts each year, or each month for invoices (LegalSeries.resetPeriod).
//
// No gaps by construction: the number is allocated INSIDE the transaction that writes the document, after
// every check has passed (generate.ts). If anything after the allocation fails, the transaction rolls back
// and the number was never taken. The advisory lock serializes allocations of one counter; the unique index
// on (series, year, month, seq) is the backstop.
//
// VOID gives a number back (owner, 14 Oct 2026) — only a document that was never signed, and only by voiding
// it (releaseLegalNumber). Its row stays and is marked released; the counter's next document takes the
// LOWEST released number before max + 1, re-issuing that row in place (same seq, re-rendered text), so the
// unique indexes never block the reuse. Nothing else ever frees a number: a row is never deleted (the
// 14 Oct review fix: issuedBy is SET NULL, so deleting a person can't make max + 1 print an old number).
//
// Addenda count per parent document: series "legal-add:<parentId>", year 0, month 0, printed as the parent's
// number + "/ADD-n". Same lock, same release and reuse.

type SeriesLike = { key: string; format: string; resetPeriod: string }

export class LegalNumberError extends Error {}

/** One counter: what the advisory lock and the "which rows" query are about. */
type Counter = { series: string; year: number; month: number; monthly: boolean }

export const ADDENDUM_SERIES_PREFIX = "legal-add:"
export const addendumCounter = (parentId: string): Counter => ({ series: `${ADDENDUM_SERIES_PREFIX}${parentId}`, year: 0, month: 0, monthly: false })

function counterOf(series: SeriesLike, at: Date): Counter {
  const { year, month } = jakartaYearMonth(at)
  return { series: series.key, year, month, monthly: series.resetPeriod === "MONTH" }
}

const counterWhere = (c: Counter): Prisma.DocumentNumberWhereInput =>
  c.monthly ? { series: c.series, year: c.year, month: c.month } : { series: c.series, year: c.year }

async function lockCounter(tx: Prisma.TransactionClient, c: Counter) {
  // Per series and YEAR, whatever the reset period (race audit 16 Oct 2026, Legal LOW). The key used to
  // carry the month for a monthly series, read from LegalSeries.resetPeriod at the time: a release made
  // after the period was changed then locked another key than the allocation it races. One key per year
  // serialises a monthly counter a little more than needed, and never too little.
  const key = `legalnum|${c.series}|${c.year}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::int8)`
}

async function nextSeq(client: Prisma.TransactionClient | typeof prisma, c: Counter) {
  const rows = await client.documentNumber.findMany({ where: counterWhere(c), select: { id: true, seq: true, releasedAt: true, releasedFromId: true } })
  const pick = pickSeq(rows.map((r) => ({ seq: r.seq, released: !!r.releasedAt })))
  const row = pick.reuse ? rows.find((r) => r.seq === pick.seq && r.releasedAt) ?? null : null
  return { seq: pick.seq, reused: row }
}

export type IssuedLegalNumber = {
  id: string; number: string; seq: number; year: number; month: number
  /** The voided document whose number this is again (link it with numberReusedById). */
  reusedFromDocumentId: string | null
}

/** Take the counter's next number (under its lock, inside the caller's transaction). */
async function issue(
  tx: Prisma.TransactionClient,
  c: Counter,
  render: (seq: number) => string,
  opts: { issuedById: string; subject?: string },
): Promise<IssuedLegalNumber> {
  await lockCounter(tx, c)
  const { seq, reused } = await nextSeq(tx, c)
  const number = render(seq)
  const data = { number, month: c.month, subject: opts.subject?.slice(0, 200) || null, issuedById: opts.issuedById }
  const select = { id: true, number: true, seq: true, year: true, month: true } as const
  try {
    if (reused) {
      // Re-issue the released row in place: (series, year, seq) stays unique, and the old text is free.
      const row = await tx.documentNumber.update({ where: { id: reused.id }, data: { ...data, releasedAt: null, releasedFromId: null, createdAt: new Date() }, select })
      return { ...row, reusedFromDocumentId: reused.releasedFromId }
    }
    const row = await tx.documentNumber.create({ data: { ...data, series: c.series, year: c.year, seq }, select })
    return { ...row, reusedFromDocumentId: null }
  } catch (error) {
    // Same printed number from another series (two series with one format) — refuse, never reuse.
    if (isUniqueViolation(error)) throw new LegalNumberError(`Number ${number} already exists. Make the series format unique (e.g. include {CO}).`)
    throw error
  }
}

export async function allocateLegalNumber(
  tx: Prisma.TransactionClient,
  opts: { series: SeriesLike; companyCode: string; fields: Record<string, unknown>; at: Date; issuedById: string; subject?: string },
): Promise<IssuedLegalNumber> {
  const c = counterOf(opts.series, opts.at)
  return issue(tx, c, (seq) => renderNumber({ format: opts.series.format, seq, year: c.year, month: c.month, companyCode: opts.companyCode, fields: opts.fields }), opts)
}

/** A parent's next addendum number ("…/ADD-n"). */
export async function allocateAddendumNumber(
  tx: Prisma.TransactionClient,
  opts: { parent: { id: string; number: string }; issuedById: string; subject?: string },
): Promise<IssuedLegalNumber> {
  return issue(tx, addendumCounter(opts.parent.id), (seq) => addendumNumber(opts.parent.number, seq), opts)
}

/**
 * Give a voided document's number back (the caller checked releasesNumberOnVoid). Same lock as allocation,
 * so a generate running now either took its number before or sees it released after. The document keeps
 * its printed `number` but no longer holds the row.
 */
export async function releaseLegalNumber(tx: Prisma.TransactionClient, doc: { id: string; documentNumberId: string }) {
  const row = await tx.documentNumber.findUnique({ where: { id: doc.documentNumberId } })
  if (!row) return
  const series = row.series.startsWith(ADDENDUM_SERIES_PREFIX) ? null : await tx.legalSeries.findUnique({ where: { key: row.series }, select: { resetPeriod: true } })
  await lockCounter(tx, { series: row.series, year: row.year, month: row.month, monthly: series?.resetPeriod === "MONTH" })
  await tx.legalDocument.update({ where: { id: doc.id }, data: { documentNumberId: null, numberReleasedAt: new Date() } })
  await tx.documentNumber.update({ where: { id: row.id }, data: { releasedAt: new Date(), releasedFromId: doc.id } })
}

/** What the next number would look like, without taking it. Never store it: it is stale the moment
 *  someone else generates a document. Missing form values print as ____. */
export async function peekLegalNumber(series: SeriesLike, companyCode: string, fields: Record<string, unknown>, at: Date): Promise<string> {
  const c = counterOf(series, at)
  const { seq } = await nextSeq(prisma, c)
  return renderNumber({ format: series.format, seq, year: c.year, month: c.month, companyCode, fields, preview: true })
}

/** A parent's next addendum: its n and number, without taking it. */
export async function peekAddendum(parent: { id: string; number: string }): Promise<{ seq: number; number: string }> {
  const { seq } = await nextSeq(prisma, addendumCounter(parent.id))
  return { seq, number: addendumNumber(parent.number, seq) }
}

/** How many numbers a series has issued (its format and reset period are then load-bearing). */
export async function issuedCount(seriesKey: string): Promise<number> {
  return prisma.documentNumber.count({ where: { series: seriesKey } })
}
