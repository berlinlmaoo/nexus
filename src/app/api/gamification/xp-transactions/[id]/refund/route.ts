export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { createInAppNotification } from "@/lib/notification-service"
import { idString, xpRefundBodySchema } from "@/lib/validations"
import { describeXpReason } from "@/lib/xp-reason"
import { refundXpTransaction, xpRefundNotice } from "@/lib/xp-refund"

/**
 * POST /api/gamification/xp-transactions/:id/refund — remove ONE XP deduction (BoD / One Above All).
 *
 * Body (optional): { note?: string }  — why, up to 200 characters; shown on the record and in the audit log.
 *
 *   200 { ok: true, refund: { id, transactionId, userId, amount, refunded, reason, kind, label, dateKey,
 *         originalCreatedAt, createdAt, note, refundedBy: { id, name } }, totalXp }
 *   400 NOT_A_DEDUCTION   the row is a gain or a 0 XP marker
 *   403 FORBIDDEN         not BoD / One Above All / system admin
 *   403 SELF_REFUND       your own deduction — another BoD removes it
 *   404 NOT_FOUND         no such row, or it belongs to someone outside your workspace
 *   409 ALREADY_REFUNDED  removed before (idempotent: a retried tap changes nothing)
 *
 * What "removed" means (zero the row, give the XP back, record who/why, and why it sticks against the
 * nightly crons) is in lib/xp-refund.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    const ctx = await getAttendanceWorkspaceContext(session.user.id)
    if (!ctx.workspace) return NextResponse.json({ error: "No workspace membership found", code: "NO_WORKSPACE" }, { status: 404 })
    if (!ctx.canManageAttendance) {
      return NextResponse.json({ error: "Hanya BoD ke atas yang bisa menghapus potongan XP.", code: "FORBIDDEN" }, { status: 403 })
    }
    const workspaceId = ctx.workspace.id

    const { id: rawId } = await params
    const idParsed = idString.safeParse(rawId)
    if (!idParsed.success) return NextResponse.json({ error: "Transaksi XP tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    const transactionId = idParsed.data

    const raw = await req.json().catch(() => ({}))
    const body = xpRefundBodySchema.safeParse(raw ?? {})
    if (!body.success) {
      return NextResponse.json({ error: body.error.issues[0]?.message ?? "Validation failed", code: "VALIDATION", details: body.error.flatten().fieldErrors }, { status: 400 })
    }

    // Whose row is it? Someone outside this workspace → "not found": not ours to confirm it exists.
    const owner = await prisma.xpTransaction.findUnique({ where: { id: transactionId }, select: { userId: true } })
      ?? await prisma.xpRefund.findUnique({ where: { transactionId }, select: { userId: true } })
    if (!owner) return NextResponse.json({ error: "Transaksi XP tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: owner.userId, workspaceId } },
      select: { userId: true },
    })
    if (!member) return NextResponse.json({ error: "Transaksi XP tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    if (owner.userId === session.user.id) {
      return NextResponse.json({ error: "Potongan XP kamu sendiri dihapus oleh BoD lain.", code: "SELF_REFUND" }, { status: 403 })
    }

    const result = await refundXpTransaction({ transactionId, workspaceId, actorId: session.user.id, note: body.data.note })
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    const r = result.refund
    const info = describeXpReason(r.reason, r.amount)

    await logAudit({
      action: "refund",
      entityType: "xp_transaction",
      entityId: r.transactionId,
      entityName: info.label,
      userId: session.user.id,
      metadata: {
        targetUserId: r.userId,
        amount: r.amount,
        refunded: r.refunded,
        reason: r.reason,
        kind: info.kind,
        date: info.dateKey,
        note: r.note,
        refundId: r.id,
      },
      request: req,
    })

    const notice = xpRefundNotice(r)
    createInAppNotification({ userId: r.userId, type: "xp_deduction_removed", title: notice.title, message: notice.message, link: `/people/${r.userId}`, push: true })
      .catch((err) => console.error("[xp-refund] notify failed", err))

    const xp = await prisma.userXp.findUnique({ where: { userId: r.userId }, select: { totalXp: true } })
    return NextResponse.json({
      ok: true,
      refund: {
        id: r.id,
        transactionId: r.transactionId,
        userId: r.userId,
        amount: r.amount,
        refunded: r.refunded,
        reason: r.reason,
        kind: info.kind,
        label: info.label,
        dateKey: info.dateKey,
        originalCreatedAt: r.originalCreatedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        note: r.note,
        refundedBy: { id: session.user.id, name: session.user.name ?? null },
      },
      totalXp: xp?.totalXp ?? null,
    })
  } catch (error) {
    console.error("xp refund POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
