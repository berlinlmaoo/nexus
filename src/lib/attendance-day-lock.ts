import type { Prisma } from "@/generated/prisma/client"

/**
 * One lock per member-day for every writer of that day's attendance penalties (race audit 16 Oct 2026,
 * H1/H2). The XP ledger already serializes per (userId, reason), but a day has several reasons (late,
 * no-checkout, alpha, the waiver) and the decisions that matter span them: "is this day pardoned?" must
 * be answered under the same lock the pardon is written under, or the per-minute accrual and the nightly
 * cron can slip a penalty in between a refund and its waiver.
 *
 * Order, wherever several locks are taken in one transaction: the request lock (`attreq|user`, H3)
 * first, then this one, then the per-reason ledger lock (`user|reason`). Transaction-scoped advisory
 * locks are re-entrant within a transaction, so a helper can take it again without harm.
 */
export async function lockAttendanceDay(tx: Prisma.TransactionClient, userId: string, dateKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attday|${userId}|${dateKey}`})::int8)`
}

const DAY_REASON = /^attendance:(late|nocheckout|alpha|waiver):(\d{4}-\d{2}-\d{2})$/

/** The member-day a ledger reason belongs to ("attendance:late:2026-10-16" → "2026-10-16"), else null. */
export function attendanceDayOfReason(reason: string): string | null {
  const m = DAY_REASON.exec(reason)
  return m ? m[2] : null
}

export function attendanceWaiverReason(dateKey: string) {
  return `attendance:waiver:${dateKey}`
}

/**
 * True if a covering request is the cron's own auto-deduction (NOT a real user-filed leave). These
 * are PENALTIES (e.g. ">120 min late → −1 day-off token", or auto-absence), so attendance flows
 * (check-in/check-out) and the report must NOT treat them like a real day-off.
 */
export function isAutoDeduction(r: { reason: string | null; reviewedById: string | null; approvalSource: string | null }) {
  return r.approvalSource === "ADMIN" && r.reviewedById === null && (r.reason ?? "").startsWith("Auto:")
}

/**
 * What an automatic penalty writer re-checks INSIDE the member-day lock, right before it writes. Each
 * field mirrors a check the caller already made outside the lock, so for a single request nothing
 * changes; only a pardon, a check-in or a request that landed in between is now seen.
 *  - the BoD waiver (always);
 *  - `requireNoCheckIn`: the day's record has neither a check-in nor a check-out (live late accrual);
 *  - `requireNoRecordFacts`: as above, and the record was not corrected by hand (alpha);
 *  - `covered`: "any" = any PENDING/APPROVED request covers the date, "real" = one that is not the cron's
 *    own auto-deduction.
 */
export type AttendanceDayGuard = {
  workspaceId: string
  date: Date
  requireNoCheckIn?: boolean
  requireNoRecordFacts?: boolean
  covered?: "any" | "real"
}

export async function attendanceDayBlockedTx(
  tx: Prisma.TransactionClient,
  userId: string,
  dateKey: string,
  guard: AttendanceDayGuard,
): Promise<"waiver" | "checked_in" | "covered" | null> {
  const waiver = await tx.xpTransaction.findFirst({ where: { userId, reason: attendanceWaiverReason(dateKey) }, select: { id: true } })
  if (waiver) return "waiver"
  if (guard.requireNoCheckIn || guard.requireNoRecordFacts) {
    const record = await tx.attendanceRecord.findUnique({
      where: { userId_workspaceId_attendanceDate: { userId, workspaceId: guard.workspaceId, attendanceDate: guard.date } },
      select: { checkInAt: true, checkOutAt: true, correctedAt: true },
    })
    if (record?.checkInAt || record?.checkOutAt) return "checked_in"
    if (guard.requireNoRecordFacts && record?.correctedAt) return "checked_in"
  }
  if (guard.covered) {
    const covering = await tx.attendanceRequest.findMany({
      where: { userId, workspaceId: guard.workspaceId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: guard.date }, endDate: { gte: guard.date } },
      select: { reason: true, reviewedById: true, approvalSource: true },
    })
    if (guard.covered === "any" ? covering.length > 0 : covering.some((r) => !isAutoDeduction(r))) return "covered"
  }
  return null
}
