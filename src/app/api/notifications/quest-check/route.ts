export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { notifyQuestClaimable } from "@/lib/notification-service"
import { AUTO_QUESTS, computeQuestProgress, currentPeriodKey } from "@/lib/gamification"

/**
 * Nudge people who have finished a quest but never collected the XP.
 *
 * Quest progress is not stored anywhere - it is recomputed on demand - so "you finished a quest"
 * is not an event anything can hook. That also means the moment a quest counts as done is the
 * moment the user taps claim, which is a useless thing to announce. The useful message is the one
 * this route sends: *you already earned this, go take it*.
 *
 * Progress and the period bucket come from `@/lib/gamification`, the same functions the quest
 * screen uses, so the badge and this notification can never tell different stories.
 *
 * Scope: count-based quests only (auto + team). `specific_tasks` bundles are left out on purpose -
 * they are visible to a whole project but claimable only by the task's assignee, and getting that
 * distinction subtly wrong would mean telling the wrong people to go claim something.
 *
 * Meant to run once a day (crontab: `0 5 * * *` UTC = 12:00 WIB).
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
    if (bearer !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const now = new Date()
    const periodKey = currentPeriodKey()

    const quests = await prisma.quest.findMany({
      where: { isActive: true, requirementType: { not: "specific_tasks" } },
      select: { id: true, title: true, requiredCount: true, xpReward: true, requirementType: true, teamIds: true, deadline: true, workspaceId: true },
    })
    const live = quests.filter((q) => !q.deadline || q.deadline >= now)

    const defs = [
      ...AUTO_QUESTS.map((q) => ({ key: q.key, title: q.title, requirementType: q.requirementType, requiredCount: q.requiredCount, teamIds: [] as string[], workspaceId: null as string | null })),
      ...live.map((q) => ({ key: q.id, title: q.title, requirementType: q.requirementType, requiredCount: q.requiredCount, teamIds: q.teamIds, workspaceId: q.workspaceId })),
    ]
    if (defs.length === 0) return NextResponse.json({ ok: true, quests: 0, sent: 0 })

    const members = await prisma.workspaceMember.findMany({ select: { userId: true, workspaceId: true } })

    let sent = 0
    for (const member of members) {
      const teamRows = await prisma.teamMember.findMany({ where: { userId: member.userId }, select: { teamId: true } })
      const teamIds = new Set(teamRows.map((t) => t.teamId))

      for (const def of defs) {
        if (def.workspaceId && def.workspaceId !== member.workspaceId) continue
        // Empty teamIds means the whole crew.
        if (def.teamIds.length > 0 && !def.teamIds.some((t) => teamIds.has(t))) continue

        const claimed = await prisma.questClaim.findUnique({
          where: { userId_questKey_periodKey: { userId: member.userId, questKey: def.key, periodKey } },
          select: { id: true },
        })
        if (claimed) continue

        const progress = await computeQuestProgress(member.userId, { requirementType: def.requirementType })
        if (progress < def.requiredCount) continue

        // One nudge per quest per period, however often this runs.
        const already = await prisma.notification.findFirst({
          where: { userId: member.userId, type: "quest_claimable", link: { contains: `${def.key}:${periodKey}` } },
          select: { id: true },
        })
        if (already) continue

        await notifyQuestClaimable({
          userId: member.userId,
          questKey: def.key,
          periodKey,
          title: def.title,
        })
        sent++
      }
    }

    return NextResponse.json({ ok: true, quests: defs.length, members: members.length, sent })
  } catch (error) {
    console.error("quest-check error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
