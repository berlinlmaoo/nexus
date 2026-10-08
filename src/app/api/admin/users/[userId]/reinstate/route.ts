export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { logAudit } from "@/lib/audit"
import { syncUserRoomsSafe } from "@/lib/chat-membership"
import { forgetRecipientState } from "@/lib/notification-service"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { OffboardRefused, offboardAuthorityError, reinstateUser } from "@/lib/offboarding"

/**
 * POST /api/admin/users/:userId/reinstate — undo an offboarding (lib/offboarding.ts reinstateUser).
 *
 * The same people as offboarding may do it, judged against the company role the person had. Their
 * member rows come back with the same role, settings and join date; projects, teams, passkeys, devices
 * and the approver edges of people who reported to them do NOT come back.
 *
 * 200 { ok, user: { id, name }, workspaces: [name], alreadyMember: [name], approverDropped: n }
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
        formerMemberships: { where: { workspaceId: ORG_WORKSPACE_ID }, select: { role: true } },
      },
    })
    const denied = offboardAuthorityError({
      action: "reinstate",
      actorId,
      actorIsSystemAdmin: context.isSystemAdmin,
      actorCompanyRole: context.orgRole,
      targetId: userId,
      targetSystemRole: target?.role ?? "MEMBER",
      // The role they had in the company (or have, if someone re-added them meanwhile).
      targetCompanyRole: target?.workspaceMembers[0]?.role ?? target?.formerMemberships[0]?.role ?? null,
    })
    if (denied) return NextResponse.json({ error: denied.error, code: denied.code }, { status: denied.status })
    if (!target) return NextResponse.json({ error: "Akun tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    if (!target.deactivatedAt) {
      return NextResponse.json({ error: "Akun ini tidak sedang di-offboard.", code: "NOT_OFFBOARDED" }, { status: 409 })
    }
    if (target.formerMemberships.length === 0 && target.workspaceMembers.length === 0 && !context.isSystemAdmin) {
      return NextResponse.json(
        { error: "Orang ini dulu bukan anggota workspace perusahaan.", code: "NOT_MEMBER" },
        { status: 409 },
      )
    }

    const result = await prisma.$transaction((tx) => reinstateUser({ userId, actorId }, tx), {
      timeout: 30000,
      maxWait: 10000,
    })

    forgetRecipientState(userId)
    // Back into the rooms of the workspaces they rejoined (project rooms only once re-added to projects).
    await syncUserRoomsSafe(userId, "reinstated")

    await logAudit({
      action: "reinstate",
      entityType: "user",
      entityId: userId,
      entityName: result.user.name,
      userId: actorId,
      request,
      metadata: {
        workspaces: result.workspaces.map((w) => w.name),
        ...(result.alreadyMember.length ? { alreadyMember: result.alreadyMember.map((w) => w.name) } : {}),
        ...(result.approverDropped.length ? { approverDropped: result.approverDropped } : {}),
      },
    })

    return NextResponse.json({
      ok: true,
      user: result.user,
      workspaces: result.workspaces.map((w) => w.name),
      alreadyMember: result.alreadyMember.map((w) => w.name),
      approverDropped: result.approverDropped.length,
    })
  } catch (error) {
    if (error instanceof OffboardRefused) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("Error reinstating user:", error)
    return NextResponse.json({ error: "Gagal mengaktifkan ulang. Tidak ada yang diubah — coba lagi.", code: "INTERNAL" }, { status: 500 })
  }
}
