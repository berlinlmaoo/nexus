export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { attendancePeriodKey, formatAttendanceDateKey, getAttendanceWorkspaceContext } from "@/lib/attendance"
import { createInAppNotification } from "@/lib/notification-service"
import { dayOffBonusCreateSchema, dayOffBonusQuerySchema } from "@/lib/validations"
import { effectiveDayOffQuota } from "@/lib/day-off-usage"
import {
  DAY_OFF_BONUS_MAX_DAYS,
  bonusGrantNotice,
  checkGrantPeriod,
  grantablePeriods,
  periodBounds,
  periodLabel,
} from "@/lib/day-off-bonus"
import { DAY_OFF_BONUS_SELECT, serializeDayOffBonus } from "@/lib/day-off-bonus-serialize"

/**
 * Extra day off for one attendance period (owner, 28 Sep 2026). See lib/day-off-bonus for the rule.
 *
 *   POST   { userIds[], periodKey, days, reason }  BoD / One Above All (canManageAttendance) only.
 *          One row per person; each gets an in-app notification + push. 201 { periodKey, …, grants[] }
 *   GET    ?periodKey=YYYY-MM[&userId=]             BoD: the workspace's grants for that period
 *          (userId narrows). Everyone else: their own, whatever userId says.
 *   DELETE /api/attendance/day-off-bonus/:id       revoke (BoD) — in [id]/route.ts
 *
 * Error bodies are { error, code } like the requests route; the codes are the contract, the Indonesian
 * text is what a client may show as is.
 */

async function context() {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }) } as const
  const ctx = await getAttendanceWorkspaceContext(session.user.id)
  if (!ctx.workspace) return { error: NextResponse.json({ error: "No workspace membership found", code: "NO_WORKSPACE" }, { status: 404 }) } as const
  return { userId: session.user.id, workspaceId: ctx.workspace.id, canManage: ctx.canManageAttendance } as const
}

function periodInfo(periodKey: string) {
  const { start, end } = periodBounds(periodKey)
  return {
    periodKey,
    periodLabel: periodLabel(periodKey, "en"),
    periodStart: formatAttendanceDateKey(start),
    periodEnd: formatAttendanceDateKey(end),
  }
}

const PERIOD_ERROR: Record<string, string> = {
  PERIOD_INVALID: "Periode harus format YYYY-MM.",
  PERIOD_TOO_OLD: "Periode itu sudah lewat lebih dari satu periode — extra day off hanya untuk periode lalu, sekarang, atau berikutnya.",
  PERIOD_TOO_FAR: "Extra day off hanya bisa untuk periode lalu, sekarang, atau berikutnya.",
}

export async function GET(req: NextRequest) {
  try {
    const g = await context()
    if ("error" in g) return g.error
    const parsed = dayOffBonusQuerySchema.safeParse({
      periodKey: req.nextUrl.searchParams.get("periodKey") || undefined,
      userId: req.nextUrl.searchParams.get("userId") || undefined,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", code: "VALIDATION", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const current = attendancePeriodKey()
    const periodKey = parsed.data.periodKey ?? current
    // Staff (and managers) see only their own grants — the list names other people and reasons.
    const userFilter = g.canManage ? parsed.data.userId : g.userId

    const [rows, mine] = await Promise.all([
      prisma.dayOffBonus.findMany({
        where: { workspaceId: g.workspaceId, periodKey, ...(userFilter ? { userId: userFilter } : {}) },
        select: DAY_OFF_BONUS_SELECT,
        orderBy: { createdAt: "desc" },
      }),
      effectiveDayOffQuota(g.workspaceId, g.userId, periodKey),
    ])

    return NextResponse.json({
      ...periodInfo(periodKey),
      currentPeriodKey: current,
      canManage: g.canManage,
      // The periods a grant may target right now (BoD UI: the period picker).
      grantablePeriods: grantablePeriods(current).map((k) => ({ periodKey: k, periodLabel: periodLabel(k, "en") })),
      // The viewer's own allowance for this period: base + bonus = quota.
      mine: { base: mine.base, bonus: mine.bonus, quota: mine.quota },
      grants: rows.map(serializeDayOffBonus),
    })
  } catch (error) {
    console.error("Error listing day-off bonuses:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await context()
    if ("error" in g) return g.error
    if (!g.canManage) {
      return NextResponse.json({ error: "Hanya BoD ke atas yang bisa kasih extra day off.", code: "FORBIDDEN" }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const parsed = dayOffBonusCreateSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", code: "VALIDATION", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { periodKey, days, reason } = parsed.data
    const userIds = Array.from(new Set(parsed.data.userIds))

    const current = attendancePeriodKey()
    const period = checkGrantPeriod(periodKey, current)
    if (!period.ok) {
      return NextResponse.json({ error: PERIOD_ERROR[period.code], code: period.code, grantablePeriods: grantablePeriods(current) }, { status: 400 })
    }

    // Members of THIS workspace only — all or nothing, so a half-applied batch never needs explaining.
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: g.workspaceId, userId: { in: userIds } },
      select: { userId: true, user: { select: { name: true } } },
    })
    const memberIds = new Set(members.map((m) => m.userId))
    const notMembers = userIds.filter((id) => !memberIds.has(id))
    if (notMembers.length > 0) {
      return NextResponse.json(
        { error: `${notMembers.length} orang bukan member workspace ini.`, code: "NOT_MEMBERS", notMembers },
        { status: 422 },
      )
    }

    // A period is ~30 days: more than 31 extra days for one person in one period is a typo.
    const existing = await prisma.dayOffBonus.groupBy({
      by: ["userId"],
      where: { workspaceId: g.workspaceId, periodKey, userId: { in: userIds }, revokedAt: null },
      _sum: { days: true },
    })
    const already = new Map(existing.map((e) => [e.userId, e._sum.days ?? 0]))
    const overLimit = userIds.filter((id) => (already.get(id) ?? 0) + days > DAY_OFF_BONUS_MAX_DAYS)
    if (overLimit.length > 0) {
      const names = members.filter((m) => overLimit.includes(m.userId)).map((m) => m.user?.name ?? m.userId)
      return NextResponse.json(
        {
          error: `Total extra day off per orang per periode maksimal ${DAY_OFF_BONUS_MAX_DAYS} hari: ${names.join(", ")}.`,
          code: "BONUS_LIMIT",
          overLimit,
        },
        { status: 422 },
      )
    }

    const created = await prisma.$transaction(
      userIds.map((userId) =>
        prisma.dayOffBonus.create({
          data: { workspaceId: g.workspaceId, userId, periodKey, days, reason, grantedById: g.userId },
          select: DAY_OFF_BONUS_SELECT,
        }),
      ),
    )

    try {
      await logAudit({
        action: "grant",
        entityType: "dayoff_bonus",
        entityId: created[0]?.id ?? periodKey,
        entityName: `dayoff-bonus:${periodKey}`,
        userId: g.userId,
        request: req,
        metadata: {
          reason: "dayoff_bonus_grant",
          periodKey,
          days,
          note: reason,
          people: userIds.length,
          targetUserIds: userIds,
          grantIds: created.map((c) => c.id),
        },
      })
    } catch { /* audit best-effort */ }

    // Tell each person. After the commit and best-effort: a failed push never undoes a grant.
    const notice = bonusGrantNotice(days, periodKey, reason)
    const sent = await Promise.allSettled(
      userIds.map((userId) =>
        createInAppNotification({ userId, type: "dayoff_bonus_granted", title: notice.title, message: notice.message, link: "/attendance", push: true }),
      ),
    )
    const notified = sent.filter((r) => r.status === "fulfilled").length
    if (notified < userIds.length) console.error("[day-off-bonus] notify failed for", userIds.length - notified, "people")

    return NextResponse.json({ ...periodInfo(periodKey), days, notified, grants: created.map(serializeDayOffBonus) }, { status: 201 })
  } catch (error) {
    console.error("Error granting day-off bonus:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
