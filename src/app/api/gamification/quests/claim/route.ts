import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { AUTO_QUESTS, awardXp, computeQuestProgress, currentPeriodKey, levelForXp, getPeriodScore, QUEST_ONCE_PERIOD } from "@/lib/gamification"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { questKey } = await req.json()
    if (!questKey) return NextResponse.json({ error: "questKey required" }, { status: 400 })

    // Resolve the quest definition (auto template or admin quest row)
    const auto = AUTO_QUESTS.find((q) => q.key === questKey)
    const admin = auto ? null : await prisma.quest.findUnique({ where: { id: questKey } })
    const isSpecificTasks = admin?.requirementType === "specific_tasks"
    const def = auto ?? (admin ? { key: admin.id, requirementType: admin.requirementType, requiredCount: admin.requiredCount, xpReward: admin.xpReward, taskIds: admin.taskIds, questId: admin.id } : null)
    if (!def) return NextResponse.json({ error: "Quest not found" }, { status: 404 })

    // Admin quest guards: must be active, not past deadline, and (per type) eligible to this user.
    if (admin) {
      if (!admin.isActive) return NextResponse.json({ error: "Quest tidak aktif" }, { status: 400 })
      if (admin.deadline && admin.deadline < new Date()) return NextResponse.json({ error: "Quest sudah lewat deadline" }, { status: 400 })
      if (isSpecificTasks) {
        // XP cuma buat yang ngerjain: claimer harus assignee dari minimal 1 task dalam quest ini.
        const isDoer = admin.taskIds.length > 0 && (await prisma.task.findFirst({ where: { id: { in: admin.taskIds }, assignees: { some: { userId } } }, select: { id: true } }))
        if (!isDoer) return NextResponse.json({ error: "Quest ini bukan task kamu — XP cuma buat yang ngerjain." }, { status: 403 })
      } else if (admin.teamIds.length > 0) {
        const inTeam = await prisma.teamMember.findFirst({ where: { userId, teamId: { in: admin.teamIds } }, select: { id: true } })
        if (!inTeam) return NextResponse.json({ error: "Quest ini bukan buat team kamu" }, { status: 403 })
      }
    }

    // specific_tasks is a one-time bundle → claim once ever (fixed period). Others reset weekly.
    const periodKey = isSpecificTasks ? QUEST_ONCE_PERIOD : currentPeriodKey()
    const already = await prisma.questClaim.findUnique({ where: { userId_questKey_periodKey: { userId, questKey, periodKey } } })
    if (already) return NextResponse.json({ error: "Already claimed this period" }, { status: 409 })

    const progress = await computeQuestProgress(userId, def)
    if (progress < def.requiredCount) return NextResponse.json({ error: "Quest not complete yet" }, { status: 400 })

    await prisma.questClaim.create({ data: { userId, questKey, periodKey, xpAwarded: def.xpReward, questId: admin?.id ?? null } })
    await awardXp(userId, def.xpReward, "quest")

    const score = await getPeriodScore(userId)
    const info = levelForXp(score)
    return NextResponse.json({ xp: { totalXp: score, level: info.level, levelName: info.name, floor: info.floor, nextFloor: info.nextFloor, pct: info.pct } })
  } catch (error) {
    console.error("quest claim error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
