export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { creditKeys, periodInfo } from "@/lib/gideon-credits"
import { notFound, requireBodPlus, reviewTarget } from "@/lib/gideon-review"

/**
 * Control Room › GIDEON › People › person › Overview (18 Oct 2026). BoD and One Above All; counts only.
 *   GET → {
 *     person: { id, name, email, avatar, role, offboarded },
 *     viewer: { canReadChats },                         // true only for the company One Above All
 *     stats:  { questions, answers, toolCalls, chats, deletedChats|null, firstUsed, lastUsed },
 *     credits: { periodKey, period: { startKey, endKey, resetsAt }, used, answers, todayUsed, tiers: [{ tier, credits, answers }] },
 *     topTier: { tier, answers } | null                  // most-used tier over all their chat runs
 *   }
 * deletedChats is null for BoD: that someone deleted chats is part of what only the OAA may see.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const g = await requireBodPlus()
  if ("error" in g) return g.error
  const { userId } = await params
  try {
    const person = await reviewTarget(userId)
    if (!person) return notFound()
    const isOaa = g.role === "ONE_ABOVE_ALL"
    const { periodKey, dayKey } = creditKeys()
    const [turns, tools, chats, deletedChats, first, last, periodUse, todayUse, periodTiers, tierRuns] = await Promise.all([
      prisma.gideonMessage.groupBy({ by: ["role"], where: { userId }, _count: { _all: true } }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT COALESCE(SUM(CARDINALITY(tools)), 0) AS n FROM "GideonMessage" WHERE "userId" = ${userId}`,
      prisma.gideonChat.count({ where: { userId, messages: { some: {} } } }),
      isOaa ? prisma.gideonChat.count({ where: { userId, deletedAt: { not: null } } }) : Promise.resolve(null),
      prisma.gideonMessage.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.gideonMessage.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.gideonCreditUsage.aggregate({ where: { userId, periodKey, billable: true }, _sum: { credits: true }, _count: { _all: true } }),
      prisma.gideonCreditUsage.aggregate({ where: { userId, dayKey, billable: true }, _sum: { credits: true } }),
      prisma.gideonCreditUsage.groupBy({ by: ["tier"], where: { userId, periodKey, billable: true }, _sum: { credits: true }, _count: { _all: true } }),
      prisma.gideonRun.groupBy({ by: ["tier"], where: { userId, trigger: "CHAT", tier: { not: null } }, _count: { _all: true } }),
    ])
    const countOf = (role: string) => turns.find((t) => t.role === role)?._count._all ?? 0
    const top = tierRuns.filter((t) => t.tier).sort((a, b) => b._count._all - a._count._all)[0]
    return NextResponse.json({
      person,
      viewer: { canReadChats: isOaa },
      stats: {
        questions: countOf("user"),
        answers: countOf("assistant"),
        toolCalls: Number(tools[0]?.n ?? 0),
        chats,
        deletedChats,
        firstUsed: first?.createdAt.toISOString() ?? null,
        lastUsed: last?.createdAt.toISOString() ?? null,
      },
      credits: {
        periodKey,
        period: periodInfo(periodKey),
        used: periodUse._sum.credits ?? 0,
        answers: periodUse._count._all,
        todayUsed: todayUse._sum.credits ?? 0,
        tiers: periodTiers
          .map((t) => ({ tier: t.tier, credits: t._sum.credits ?? 0, answers: t._count._all }))
          .sort((a, b) => b.answers - a.answers),
      },
      topTier: top ? { tier: top.tier as string, answers: top._count._all } : null,
    })
  } catch (error) {
    console.error("gideon person overview error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
