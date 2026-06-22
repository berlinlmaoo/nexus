import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { levelForXp, getLeaderboardPeriodStart, getLeaderboardPeriodEnd, PERIOD_BASELINE_XP } from "@/lib/gamification"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Users who share a workspace with the caller.
    const myWorkspaces = await prisma.workspaceMember.findMany({ where: { userId: session.user.id }, select: { workspaceId: true } })
    const workspaceIds = myWorkspaces.map((m) => m.workspaceId)
    if (workspaceIds.length === 0) return NextResponse.json({ rows: [] })

    const memberships = await prisma.workspaceMember.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { userId: true, role: true },
    })
    const userIds = Array.from(new Set(memberships.map((m) => m.userId)))
    // BoD + One-Above-All are EXCLUDED from the leaderboard entirely (management isn't competing with
    // staff). A user is excluded if they hold that role in ANY shared workspace.
    const excluded = new Set(
      memberships.filter((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL").map((m) => m.userId),
    )

    // Monthly leaderboard: every user starts each period at PERIOD_BASELINE_XP (1000)
    // and quests push their score up/down. Period resets on the 28th 00:00 Asia/Jakarta.
    const periodStart = getLeaderboardPeriodStart()
    const periodEnd = getLeaderboardPeriodEnd()

    const [periodTxns, users] = await Promise.all([
      prisma.xpTransaction.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds }, createdAt: { gte: periodStart } },
        _sum: { amount: true },
      }),
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, avatar: true } }),
    ])

    const deltaById = new Map(periodTxns.map((t) => [t.userId, t._sum.amount ?? 0]))

    // Staff peers only (BoD+ excluded) — each sits at baseline 1000 until quests move them.
    const rows = users
      .filter((u) => !excluded.has(u.id))
      .map((u) => {
        const score = PERIOD_BASELINE_XP + (deltaById.get(u.id) ?? 0)
        const info = levelForXp(score)
        return {
          userId: u.id,
          name: u.name ?? null,
          avatar: u.avatar ?? null,
          totalXp: score, // points shown on the leaderboard = this period's score
          level: info.level,
          levelName: info.name,
        }
      })
      // Rank by score, then name.
      .sort((a, b) => b.totalXp - a.totalXp || (a.name ?? "").localeCompare(b.name ?? ""))

    return NextResponse.json({
      rows,
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString(), resetDay: 28, timezone: "Asia/Jakarta" },
    })
  } catch (error) {
    console.error("leaderboard error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
