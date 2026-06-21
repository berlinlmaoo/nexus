import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { AUTO_QUESTS, computeQuestProgress, currentPeriodKey, levelForXp, getPeriodScore, applyAutoPenalties, QUEST_ONCE_PERIOD } from "@/lib/gamification"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    // Lazily apply any due penalty quests (idempotent per period) before reading the score.
    await applyAutoPenalties(userId).catch((e) => console.error("applyAutoPenalties:", e))

    const [score, streak, memberships, claims, teamMembers, projectMembers] = await Promise.all([
      getPeriodScore(userId),
      prisma.userStreak.findUnique({ where: { userId } }),
      prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
      // Weekly claims + the one-time bucket (specific_tasks quests are claimed once ever).
      prisma.questClaim.findMany({ where: { userId, periodKey: { in: [currentPeriodKey(), QUEST_ONCE_PERIOD] } } }),
      prisma.teamMember.findMany({ where: { userId }, select: { teamId: true } }),
      prisma.projectMember.findMany({ where: { userId }, select: { projectId: true } }),
    ])

    // Score is period-based (baseline 1000 ± this period's quest deltas); drives level too.
    const totalXp = score
    const info = levelForXp(totalXp)
    const workspaceIds = memberships.map((m) => m.workspaceId)
    const adminQuestsRaw = workspaceIds.length
      ? await prisma.quest.findMany({ where: { workspaceId: { in: workspaceIds }, isActive: true } })
      : []

    const now = new Date()
    const userTeamIds = new Set(teamMembers.map((t) => t.teamId))
    const userProjectIds = new Set(projectMembers.map((p) => p.projectId))
    const liveQuests = adminQuestsRaw.filter((q) => !q.deadline || q.deadline >= now)

    // Team/auto quests: visible by team assignment (empty = semua crew).
    const teamQuests = liveQuests.filter(
      (q) => q.requirementType !== "specific_tasks" && (q.teamIds.length === 0 || q.teamIds.some((t) => userTeamIds.has(t)))
    )

    // specific_tasks quests are VISIBLE to anyone in a project that owns one of the quest's tasks; XP is
    // CLAIMABLE only by a task's assignee (the doer). Fetch every referenced task once for both checks.
    const taskQuests = liveQuests.filter((q) => q.requirementType === "specific_tasks")
    const allTaskIds = [...new Set(taskQuests.flatMap((q) => q.taskIds))]
    const tasksById = new Map<string, { status: string; projectId: string | null; assigneeIds: Set<string> }>()
    if (allTaskIds.length) {
      const rows = await prisma.task.findMany({
        where: { id: { in: allTaskIds } },
        select: { id: true, status: true, taskList: { select: { projectId: true } }, assignees: { select: { userId: true } } },
      })
      for (const r of rows) {
        tasksById.set(r.id, { status: r.status, projectId: r.taskList?.projectId ?? null, assigneeIds: new Set(r.assignees.map((a) => a.userId)) })
      }
    }

    const claimedKeys = new Set(claims.map((c) => c.questKey))

    // Team/auto quests reuse the count-based progress.
    const baseDefs = [
      ...AUTO_QUESTS.map((q) => ({ ...q, source: "auto" as const, deadline: null as Date | null })),
      ...teamQuests.map((q) => ({ key: q.id, title: q.title, description: q.description, requirementType: q.requirementType, requiredCount: q.requiredCount, xpReward: q.xpReward, deadline: q.deadline, source: "admin" as const })),
    ]
    const baseQuests = await Promise.all(baseDefs.map(async (q) => {
      const progress = await computeQuestProgress(userId, q)
      const claimed = claimedKeys.has(q.key)
      return { key: q.key, title: q.title, description: (q as { description?: string | null }).description ?? null, progress, target: q.requiredCount, xpReward: q.xpReward, deadline: q.deadline ?? null, source: q.source, kind: "count" as const, claimed, claimable: progress >= q.requiredCount && !claimed }
    }))

    // specific_tasks quests, computed in-memory from the fetched tasks.
    const taskQuestViews = taskQuests
      .map((q) => {
        const ts = q.taskIds.map((id) => tasksById.get(id)).filter(Boolean) as { status: string; projectId: string | null; assigneeIds: Set<string> }[]
        const visible = ts.some((t) => t.projectId && userProjectIds.has(t.projectId))
        if (!visible) return null
        const target = q.taskIds.length
        const progress = ts.filter((t) => t.status === "DONE").length
        const isDoer = ts.some((t) => t.assigneeIds.has(userId))
        const claimed = claimedKeys.has(q.id)
        return {
          key: q.id, title: q.title, description: q.description, progress, target, xpReward: q.xpReward,
          deadline: q.deadline ?? null, source: "admin" as const, kind: "tasks" as const,
          claimed, claimable: progress >= target && isDoer && !claimed, eligible: isDoer,
        }
      })
      .filter(Boolean)

    const quests = [...baseQuests, ...taskQuestViews]

    return NextResponse.json({
      xp: { totalXp, level: info.level, levelName: info.name, floor: info.floor, nextFloor: info.nextFloor, pct: info.pct },
      streak: { current: streak?.currentStreak ?? 0, longest: streak?.longestStreak ?? 0 },
      quests,
    })
  } catch (error) {
    console.error("gamification/me error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
