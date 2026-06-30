export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { getAttendanceWorkspaceContext, formatAttendanceDateKey } from "@/lib/attendance"
import { awardXpOnce } from "@/lib/gamification"
import { startFloor } from "@/lib/attendance-absence"
import { notifyOffsiteCheckoutReviewed } from "@/lib/wa-bot"

// Approve / reject an offsite checkout (BoD only).
// Semantics: APPROVE = the offsite checkout is valid, nothing else changes. REJECT = treated like a
// no-checkout → a one-time -25 XP penalty (applied here, event-driven, so it doesn't depend on the
// nightly cron's rolling lookback window). Reject does NOT rewrite the late/early/worked ledger.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const context = await getAttendanceWorkspaceContext(session.user.id)
  if (!context.workspace) return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
  if (!context.canManageAttendance) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { recordId } = await params

  let body: { action?: unknown }
  try {
    body = (await request.json()) as { action?: unknown }
  } catch {
    body = {}
  }
  const action = body.action
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'." }, { status: 400 })
  }

  const record = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, workspaceId: true, checkOutOffsite: true, checkOutApproval: true, userId: true, attendanceDate: true },
  })
  if (!record || record.workspaceId !== context.workspace.id || !record.checkOutOffsite) {
    return NextResponse.json({ error: "Offsite checkout not found." }, { status: 404 })
  }
  if (record.checkOutApproval !== "PENDING") {
    return NextResponse.json({ error: "Checkout ini sudah diproses." }, { status: 409 })
  }
  // Four-eyes: a BoD can't approve/reject their own offsite checkout.
  if (record.userId === session.user.id) {
    return NextResponse.json({ error: "Kamu nggak bisa approve checkout kamu sendiri." }, { status: 403 })
  }

  const nextStatus = action === "approve" ? "APPROVED" : "REJECTED"
  // Atomic conditional write — only the first reviewer (record still PENDING) wins (no TOCTOU race).
  const result = await prisma.attendanceRecord.updateMany({
    where: { id: record.id, checkOutOffsite: true, checkOutApproval: "PENDING" },
    data: { checkOutApproval: nextStatus, checkOutApprovedById: session.user.id, checkOutApprovedAt: new Date() },
  })
  if (result.count !== 1) {
    return NextResponse.json({ error: "Checkout ini sudah diproses." }, { status: 409 })
  }

  // Rejected offsite checkout = treated as no-checkout → -25 XP (idempotent by reason key).
  // Floor-gated like every other attendance penalty: no penalty for days before the policy go-live.
  if (nextStatus === "REJECTED" && record.attendanceDate.getTime() >= startFloor().getTime()) {
    try {
      await awardXpOnce(record.userId, -25, `attendance:nocheckout:${formatAttendanceDateKey(record.attendanceDate)}`)
    } catch (xpErr) {
      console.error("offsite reject XP penalty failed:", xpErr)
    }
  }

  try {
    await logAudit({ action: "update", entityType: "attendance_record", entityId: record.id, entityName: "offsite checkout " + nextStatus.toLowerCase(), userId: session.user.id, request, metadata: { offsiteApproval: nextStatus, targetUserId: record.userId } })
  } catch {
    /* best-effort */
  }

  // Tell the staff (offsite checkout approved/rejected + who) and the other approvers it's handled.
  notifyOffsiteCheckoutReviewed({ recordId: record.id, reviewerId: session.user.id, reviewerName: session.user.name ?? null, approved: nextStatus === "APPROVED" })
    .catch((e) => console.error("[wa] notifyOffsiteCheckoutReviewed failed", e))

  return NextResponse.json({ ok: true, id: record.id, approval: nextStatus })
}
