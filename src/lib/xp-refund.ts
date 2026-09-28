import prisma from "@/lib/prisma"
import { applyXpDelta } from "@/lib/gamification"
import { describeXpReason, xpRefundDecision } from "@/lib/xp-reason"

/**
 * "Remove this deduction" — the BoD hands back ONE XP deduction, exactly its amount (owner, 28 Sep 2026).
 *
 * How, and why this way:
 *   - The ledger row stays and its amount becomes 0; UserXp.totalXp gets the amount back (+level);
 *     an XpRefund row records what it was (reason, amount, when), who removed it and why.
 *   - Zeroing, not a compensating +N row and not a delete, because every other reader already does
 *     the right thing with a 0 row:
 *       · the leaderboard, Reports per crew and the board's XP pill SUM the ledger → the period is
 *         repaired in the period the deduction was in (a +N row would land in today's period instead);
 *       · awardXpOnce (nocheckout, alpha, the cron's late backstop, peer reports) is idempotent on the
 *         row EXISTING, so the nightly cron cannot re-cut it — the row is still there;
 *       · a later whole-day clear (BoD "Clear penalty", an approved leave, reversePeerReportXp) sums
 *         and deletes the rows of that reason → it hands back 0 for this one, never a second time
 *         (a +N row would have been refunded twice: once here, once by that sum);
 *       · the "XP berkurang" popup and the deduction log list amount < 0 only → it disappears there.
 *   - The one writer that SETS an amount instead of inserting once is setLatePenalty (live late accrual
 *     and the check-in). It skips a row with an XpRefund (gamification.ts), so a removed late penalty
 *     stays removed — without waiving the whole day the way "Clear penalty" does, which would also
 *     have swallowed that day's other penalties.
 *   - Idempotent: XpRefund.transactionId is unique; the check and the write run in one transaction
 *     under the same advisory lock (userId|reason) every writer of that reason takes.
 *
 * The auto day-off a >120-minute lateness or a TK cuts is a day-off, not XP, and is untouched here —
 * that is the board's "Clear penalty" / "Change status".
 */

export type XpRefundResult =
  | {
      ok: true
      refund: {
        id: string
        transactionId: string
        userId: string
        reason: string
        amount: number
        refunded: number
        originalCreatedAt: Date
        note: string | null
        createdAt: Date
      }
    }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }

const NOT_FOUND = { ok: false as const, status: 404 as const, code: "NOT_FOUND", error: "Transaksi XP tidak ditemukan." }
const ALREADY = { ok: false as const, status: 409 as const, code: "ALREADY_REFUNDED", error: "Potongan XP ini sudah dihapus sebelumnya." }

export async function refundXpTransaction(opts: {
  transactionId: string
  workspaceId: string
  actorId: string
  note?: string | null
}): Promise<XpRefundResult> {
  const { transactionId, workspaceId, actorId } = opts
  const note = (opts.note ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null

  // Who and which reason, for the lock key. Read again inside the transaction under the lock.
  const head = await prisma.xpTransaction.findUnique({ where: { id: transactionId }, select: { userId: true, reason: true } })
  if (!head) {
    // Removed once and then deleted by a whole-day clear: still "already removed", not "never existed".
    const prior = await prisma.xpRefund.findUnique({ where: { transactionId }, select: { id: true } })
    return prior ? ALREADY : NOT_FOUND
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${head.userId}|${head.reason}`})::int8)`
      const [row, prior] = await Promise.all([
        tx.xpTransaction.findUnique({ where: { id: transactionId }, select: { id: true, userId: true, amount: true, reason: true, createdAt: true } }),
        tx.xpRefund.findUnique({ where: { transactionId }, select: { id: true } }),
      ])
      if (!row) return prior ? ALREADY : NOT_FOUND
      const decision = xpRefundDecision(row, Boolean(prior))
      if (!decision.ok) return decision
      // Captured before the write: what the row WAS is what the record and the audit log report.
      const original = { amount: row.amount, reason: row.reason, createdAt: row.createdAt }

      await tx.xpTransaction.update({ where: { id: row.id }, data: { amount: 0 } })
      await applyXpDelta(tx, row.userId, decision.refund)
      const created = await tx.xpRefund.create({
        data: {
          transactionId: row.id,
          userId: row.userId,
          workspaceId,
          reason: original.reason,
          amount: original.amount,
          originalCreatedAt: original.createdAt,
          refundedById: actorId,
          note,
        },
        select: { id: true, createdAt: true },
      })
      return {
        ok: true as const,
        refund: {
          id: created.id,
          transactionId: row.id,
          userId: row.userId,
          reason: original.reason,
          amount: original.amount,
          refunded: decision.refund,
          originalCreatedAt: original.createdAt,
          note,
          createdAt: created.createdAt,
        },
      }
    })
  } catch (err) {
    // Two BoD pressing at once: the unique transactionId stops the second one.
    if ((err as { code?: string })?.code === "P2002") return ALREADY
    throw err
  }
}

/** The push/in-app copy for the person whose deduction was removed (Indonesian, like the other attendance pushes). */
export function xpRefundNotice(refund: { reason: string; amount: number; refunded: number }) {
  const info = describeXpReason(refund.reason, refund.amount)
  const what: Record<string, string> = {
    late: "telat check-in",
    nocheckout: "lupa check-out",
    alpha: "tanpa keterangan (TK)",
    peer_penalty: "laporan integritas",
    admin_adjust: "penyesuaian BoD",
    quest_penalty: "penalty quest",
  }
  const label = what[info.kind] ?? "potongan XP"
  const day = info.dateKey ? ` tanggal ${info.dateKey}` : ""
  return {
    title: `Potongan XP dihapus · +${refund.refunded} XP`,
    message: `BoD menghapus potongan ${label}${day} (${refund.amount} XP). XP-nya sudah kembali.`,
  }
}
