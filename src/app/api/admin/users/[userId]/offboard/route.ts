export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { logAudit } from "@/lib/audit"
import { syncUserRoomsSafe } from "@/lib/chat-membership"
import { forgetRecipientState } from "@/lib/notification-service"
import { formatAttendanceDateKey } from "@/lib/attendance"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { OffboardRefused, isOffboardReason, offboardAuthorityError, offboardUser, parseDateKey } from "@/lib/offboarding"

/**
 * POST /api/admin/users/:userId/offboard — { lastWorkingDay?: "YYYY-MM-DD", reason, note? }
 *
 * Someone left the company (lib/offboarding.ts has what happens and what stays). Who: a system ADMIN,
 * or BoD / One Above All of the company workspace; never yourself; never someone of equal or higher
 * company role unless you are a system ADMIN or One Above All. lastWorkingDay defaults to today (Jakarta).
 *
 * 200 { ok, user: { id, name }, leftAt, lastWorkingDay, workspaces: [name], approverEdgesCleared: [{ id, name }],
 *       pendingRequests, autoDeductionsCanceled, openTasks }
 * Every refusal: { error (Indonesian, shown as is), code }.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { session, context } = await getAdminSessionContext()
    if (!context?.user || !session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    }
    const userId = (await params).userId
    const actorId = session.user.id

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        deactivatedAt: true,
        workspaceMembers: { where: { workspaceId: ORG_WORKSPACE_ID }, select: { role: true } },
      },
    })
    const denied = offboardAuthorityError({
      action: "offboard",
      actorId,
      actorIsSystemAdmin: context.isSystemAdmin,
      actorCompanyRole: context.orgRole,
      targetId: userId,
      targetSystemRole: target?.role ?? "MEMBER",
      targetCompanyRole: target?.workspaceMembers[0]?.role ?? null,
    })
    if (denied) return NextResponse.json({ error: denied.error, code: denied.code }, { status: denied.status })
    if (!target) return NextResponse.json({ error: "Akun tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    if (target.deactivatedAt) {
      return NextResponse.json({ error: "Akun ini sudah di-offboard.", code: "ALREADY_OFFBOARDED" }, { status: 409 })
    }
    // Company authority reaches company members. A system admin may also offboard someone who is only
    // in other workspaces.
    if (target.workspaceMembers.length === 0 && !context.isSystemAdmin) {
      return NextResponse.json(
        { error: "Orang ini bukan anggota workspace perusahaan.", code: "NOT_MEMBER" },
        { status: 409 },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | { lastWorkingDay?: unknown; reason?: unknown; note?: unknown }
      | null
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Isi permintaan tidak valid.", code: "BAD_REQUEST" }, { status: 400 })
    }
    if (!isOffboardReason(body.reason)) {
      return NextResponse.json(
        { error: "Pilih alasan: RESIGNED, CONTRACT_ENDED, DISMISSED, atau OTHER.", code: "BAD_REASON" },
        { status: 400 },
      )
    }
    const rawDay = body.lastWorkingDay === undefined || body.lastWorkingDay === null || body.lastWorkingDay === ""
      ? formatAttendanceDateKey()
      : body.lastWorkingDay
    const lastWorkingDay = parseDateKey(rawDay)
    if (!lastWorkingDay) {
      return NextResponse.json({ error: "Hari kerja terakhir harus tanggal YYYY-MM-DD.", code: "BAD_DATE" }, { status: 400 })
    }
    if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
      return NextResponse.json({ error: "Catatan harus teks.", code: "BAD_REQUEST" }, { status: 400 })
    }

    // The date checks (not after today, not before they joined) and the target-side guards run again
    // inside the transaction, against the rows it writes.
    const result = await prisma.$transaction(
      (tx) => offboardUser({ userId, actorId, lastWorkingDay, reason: body.reason as never, note: (body.note as string | null | undefined) ?? null }, tx),
      { timeout: 30000, maxWait: 10000 },
    )

    // Notifications stop at once in this process (lib/notification-service.ts caches for a minute).
    forgetRecipientState(userId)
    // Out of every chat room of the workspaces they left; their messages stay.
    await syncUserRoomsSafe(userId, "offboarded")

    await logAudit({
      action: "offboard",
      entityType: "user",
      entityId: userId,
      entityName: result.user.name,
      userId: actorId,
      request,
      metadata: {
        leftAt: result.lastWorkingDay,
        reason: body.reason,
        ...(typeof body.note === "string" && body.note.trim() ? { note: body.note.trim().slice(0, 500) } : {}),
        workspaces: result.workspaces.map((w) => w.name),
        approverEdgesCleared: result.approverEdgesCleared.map((p) => p.name),
        pendingRequests: result.pendingRequests,
        autoDeductionsCanceled: result.autoDeductionsCanceled,
        openTasks: result.openTasks,
        ...result.removed,
      },
    })

    return NextResponse.json({
      ok: true,
      user: result.user,
      leftAt: result.leftAt.toISOString(),
      lastWorkingDay: result.lastWorkingDay,
      workspaces: result.workspaces.map((w) => w.name),
      approverEdgesCleared: result.approverEdgesCleared,
      pendingRequests: result.pendingRequests,
      autoDeductionsCanceled: result.autoDeductionsCanceled,
      openTasks: result.openTasks,
    })
  } catch (error) {
    if (error instanceof OffboardRefused) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("Error offboarding user:", error)
    return NextResponse.json({ error: "Offboard gagal. Tidak ada yang diubah — coba lagi.", code: "INTERNAL" }, { status: 500 })
  }
}
