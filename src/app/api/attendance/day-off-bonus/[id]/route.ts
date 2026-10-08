export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { restorableSoftDelete } from "@/lib/deletion-snapshot"
import { attendancePeriodKey, getAttendanceWorkspaceContext } from "@/lib/attendance"
import { checkGrantPeriod, grantablePeriods } from "@/lib/day-off-bonus"
import { DAY_OFF_BONUS_SELECT, serializeDayOffBonus } from "@/lib/day-off-bonus-serialize"

/**
 * DELETE /api/attendance/day-off-bonus/:id — revoke one extra-day-off grant (BoD / One Above All).
 *
 * The row stays (revokedAt, revokedById) and simply stops counting. Idempotent: revoking a revoked
 * grant answers 200 with `alreadyRevoked: true`, so a retried tap is not an error. Same period window
 * as granting — a grant for a period older than the previous one is payroll history and stays.
 * Days already taken on the strength of the grant are not undone; the balance just shows 0 left
 * (the display caps, as it does for anyone over quota).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    const ctx = await getAttendanceWorkspaceContext(session.user.id)
    if (!ctx.workspace) return NextResponse.json({ error: "No workspace membership found", code: "NO_WORKSPACE" }, { status: 404 })
    if (!ctx.canManageAttendance) {
      return NextResponse.json({ error: "Hanya BoD ke atas yang bisa mencabut extra day off.", code: "FORBIDDEN" }, { status: 403 })
    }
    const workspaceId = ctx.workspace.id

    const { id } = await params
    const target = await prisma.dayOffBonus.findUnique({ where: { id }, select: DAY_OFF_BONUS_SELECT })
    // Another workspace's grant is "not found", not "forbidden": its existence is not ours to confirm.
    if (!target || target.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Extra day off tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    }
    if (target.revokedAt) {
      return NextResponse.json({ grant: serializeDayOffBonus(target), alreadyRevoked: true })
    }

    const current = attendancePeriodKey()
    const period = checkGrantPeriod(target.periodKey, current)
    if (!period.ok) {
      return NextResponse.json(
        { error: "Periode grant ini sudah ditutup — tidak bisa dicabut lagi.", code: period.code, grantablePeriods: grantablePeriods(current) },
        { status: 400 },
      )
    }

    // Conditional on still being active: two BoD tapping Revoke at once both get a clean answer. The
    // revoke is in the audit first, with a copy of the grant's state, so Control Room → Audit can
    // grant it again.
    let revoked = 0
    await restorableSoftDelete({
      action: "revoke", entityType: "dayoff_bonus", entityId: id,
      entityName: `${target.user?.name ?? "Someone"} · ${target.days} extra day${target.days === 1 ? "" : "s"} off · ${target.periodKey}`,
      workspaceId, userId: session.user.id, request: req,
      metadata: { reason: "dayoff_bonus_revoke", periodKey: target.periodKey, days: target.days, note: target.reason, targetUserId: target.userId },
      meta: { open: null },
      apply: async (tx) => {
        revoked = (await tx.dayOffBonus.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: session.user.id } })).count
      },
    })
    const after = await prisma.dayOffBonus.findUnique({ where: { id }, select: DAY_OFF_BONUS_SELECT })
    if (!after) return NextResponse.json({ error: "Extra day off tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    if (revoked === 0) return NextResponse.json({ grant: serializeDayOffBonus(after), alreadyRevoked: true })

    return NextResponse.json({ grant: serializeDayOffBonus(after), alreadyRevoked: false })
  } catch (error) {
    console.error("Error revoking day-off bonus:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
