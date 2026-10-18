export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { creditSummary } from "@/lib/gideon-credits"

/**
 * GET /api/gideon/credits — the signed-in person's GIDEON credits (owner, 18 Oct 2026): today against the
 * daily allowance, this period's monthly pool (+ bonus), and whether phase 2 is enforcing.
 *   ?history=1[&before=<ISO>][&limit=50] — also their own answers, newest first (the usage history view).
 * Only ever the caller's own numbers: there is no userId parameter here (the admin view is /admin).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  try {
    const summary = await creditSummary(userId)
    const url = new URL(req.url)
    if (url.searchParams.get("history") !== "1") return NextResponse.json({ summary })

    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50))
    const beforeRaw = url.searchParams.get("before")
    const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null
    const rows = await prisma.gideonCreditUsage.findMany({
      where: { userId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: {
        id: true, runId: true, trigger: true, tier: true, requestedTier: true, inputTokens: true, cachedTokens: true, outputTokens: true,
        reasoningTokens: true, credits: true, dailyCredits: true, poolCredits: true, overCredits: true, billable: true, unlimited: true,
        fallback: true, dayKey: true, periodKey: true, createdAt: true,
      },
    })
    const page = rows.slice(0, limit)
    // The question's first line (the run title) is the asker's own, so it may be shown back to them.
    const runIds = page.map((r) => r.runId).filter((x): x is string => Boolean(x))
    const runs = runIds.length ? await prisma.gideonRun.findMany({ where: { id: { in: runIds }, userId }, select: { id: true, title: true } }) : []
    const titles = new Map(runs.map((r) => [r.id, r.title]))
    // Per-day totals for the period (a small bar list on the history view).
    const days = await prisma.gideonCreditUsage.groupBy({
      by: ["dayKey"],
      where: { userId, periodKey: summary.periodKey, billable: true },
      _sum: { credits: true },
      _count: { _all: true },
      orderBy: { dayKey: "asc" },
    })
    return NextResponse.json({
      summary,
      items: page.map(({ runId, ...r }) => ({ ...r, title: runId ? titles.get(runId) ?? null : null })),
      nextBefore: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
      days: days.map((d) => ({ dayKey: d.dayKey, credits: d._sum.credits ?? 0, answers: d._count._all })),
    })
  } catch (error) {
    console.error("gideon credits error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
