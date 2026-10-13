import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { jakartaYearMonth, renderNumber } from "@/lib/legal/rules"

// Legal document numbers: one DocumentNumber row per number actually issued, sequential per series with no
// gaps (owner, 14 Oct 2026). The counter restarts each year, or each month for invoices (LegalSeries.resetPeriod).
//
// No gaps by construction: the number is allocated INSIDE the transaction that writes the document, after
// every check has passed (generate.ts). If anything after the allocation fails, the transaction rolls back
// and the number was never taken. The advisory lock serializes allocations of one counter; the unique index
// on (series, year, month, seq) is the backstop.

type SeriesLike = { key: string; format: string; resetPeriod: string }

export class LegalNumberError extends Error {}

function scopeOf(series: SeriesLike, year: number, month: number) {
  return series.resetPeriod === "MONTH" ? { series: series.key, year, month } : { series: series.key, year }
}

export type IssuedLegalNumber = { id: string; number: string; seq: number; year: number; month: number }

export async function allocateLegalNumber(
  tx: Prisma.TransactionClient,
  opts: { series: SeriesLike; companyCode: string; fields: Record<string, unknown>; at: Date; issuedById: string; subject?: string },
): Promise<IssuedLegalNumber> {
  const { year, month } = jakartaYearMonth(opts.at)
  const counter = `legalnum|${opts.series.key}|${year}|${opts.series.resetPeriod === "MONTH" ? month : "Y"}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${counter})::int8)`
  const last = await tx.documentNumber.findFirst({
    where: scopeOf(opts.series, year, month),
    orderBy: { seq: "desc" },
    select: { seq: true },
  })
  const seq = (last?.seq ?? 0) + 1
  const number = renderNumber({ format: opts.series.format, seq, year, month, companyCode: opts.companyCode, fields: opts.fields })
  try {
    return await tx.documentNumber.create({
      data: { series: opts.series.key, year, month, seq, number, subject: opts.subject?.slice(0, 200) || null, issuedById: opts.issuedById },
      select: { id: true, number: true, seq: true, year: true, month: true },
    })
  } catch (error) {
    // Same printed number from another series (two series with one format) — refuse, never reuse.
    if (isUniqueViolation(error)) throw new LegalNumberError(`Number ${number} already exists. Make the series format unique (e.g. include {CO}).`)
    throw error
  }
}

/** What the next number would look like, without taking it. Never store it: it is stale the moment
 *  someone else generates a document. Missing form values print as ____. */
export async function peekLegalNumber(series: SeriesLike, companyCode: string, fields: Record<string, unknown>, at: Date): Promise<string> {
  const { year, month } = jakartaYearMonth(at)
  const last = await prisma.documentNumber.findFirst({ where: scopeOf(series, year, month), orderBy: { seq: "desc" }, select: { seq: true } })
  return renderNumber({ format: series.format, seq: (last?.seq ?? 0) + 1, year, month, companyCode, fields, preview: true })
}

/** How many numbers a series has issued (its format and reset period are then load-bearing). */
export async function issuedCount(seriesKey: string): Promise<number> {
  return prisma.documentNumber.count({ where: { series: seriesKey } })
}
