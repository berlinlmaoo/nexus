export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { reportableUserIds } from "@/lib/attendance-approvers"
import { buildMemberRecord, buildRecordXp, parseRecordPeriod, recordWindow } from "@/lib/member-record"
import { memberRecordQuerySchema } from "@/lib/validations"

/**
 * GET /api/members/:userId/record?period=YYYY-MM[&only=xp] — one person's record for one attendance
 * period (28th → 27th; default the current one). `:userId` may be "me".
 *
 * Who may look (lib/attendance-approvers reportableUserIds, the rule Reports per crew uses):
 *   BoD / One Above All / system admin → anyone in the workspace
 *   a manager in the Bagan Approval    → their direct reports (one level) and themselves
 *   everyone else                      → themselves
 *   otherwise 403 FORBIDDEN.
 *
 * `only=xp` answers just { period, xp } for that period — the "Load older" button walks back a
 * period at a time with it.
 *
 * The person themself sees their own XP log in full (the same rows /api/gamification/xp-log gives
 * any colleague); only the BoD gets `canRemove` on a deduction.
 *
 * Someone who left (offboarding, 8 Oct 2026) keeps their record: role and join date come from what their
 * member row said (FormerMember), and `person.leftAt` (ISO, additive) is their last working day.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await auth()
    const viewerId = session?.user?.id
    if (!viewerId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })

    const { userId: rawUserId } = await params
    const parsed = memberRecordQuerySchema.safeParse({
      userId: rawUserId,
      period: request.nextUrl.searchParams.get("period") ?? undefined,
      only: request.nextUrl.searchParams.get("only") ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validation failed", code: "VALIDATION", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const targetId = parsed.data.userId === "me" ? viewerId : parsed.data.userId
    const period = parseRecordPeriod(parsed.data.period)
    if (!period.ok) return NextResponse.json({ error: period.error, code: period.code }, { status: 400 })

    const scope = await reportableUserIds(viewerId)
    if (!scope.workspaceId) return NextResponse.json({ error: "No workspace membership found", code: "NO_WORKSPACE" }, { status: 404 })
    if (!scope.userIds.includes(targetId)) {
      return NextResponse.json({ error: "Kamu tidak bisa melihat rekap orang ini.", code: "FORBIDDEN" }, { status: 403 })
    }
    const workspaceId = scope.workspaceId
    const canManage = scope.mode === "ALL"
    const isSelf = targetId === viewerId

    if (parsed.data.only === "xp") {
      const xp = await buildRecordXp({ workspaceId, userId: targetId, window: recordWindow(period.key), canRemove: canManage && !isSelf })
      return NextResponse.json({ period: period.key, xp: { entries: xp.entries, totals: xp.totals, hasOlder: xp.hasOlder, olderPeriod: xp.olderPeriod } })
    }

    const leftAt = scope.formerLeftAt.get(targetId) ?? null
    const [user, currentMember, former, record] = await Promise.all([
      prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, email: true, avatar: true } }),
      prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: targetId, workspaceId } },
        select: { role: true, joinedAt: true },
      }),
      leftAt
        ? prisma.formerMember.findUnique({ where: { userId_workspaceId: { userId: targetId, workspaceId } }, select: { role: true, joinedAt: true } })
        : Promise.resolve(null),
      buildMemberRecord({ workspaceId, userId: targetId, periodKey: period.key, viewerId, canManage }),
    ])
    const member = currentMember ?? former
    if (!user || !member) return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 })

    if (!isSelf) {
      await logAudit({
        action: "view",
        entityType: "member_record",
        entityId: targetId,
        entityName: user.name ?? user.email ?? undefined,
        userId: viewerId,
        metadata: { scope: scope.mode, period: period.key },
        request,
      })
    }

    return NextResponse.json({
      person: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar ?? null,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        isSelf,
        ...(leftAt && !currentMember ? { leftAt: leftAt.toISOString() } : {}),
      },
      viewer: {
        scope: scope.mode,
        /** May set a day's status (the board's Change status) and remove deductions. */
        canManageAttendance: canManage,
        canRemoveXp: canManage && !isSelf,
      },
      ...record,
    })
  } catch (error) {
    console.error("member record GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
