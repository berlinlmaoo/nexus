export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAttendanceWorkspaceContext, formatAttendanceDateKey } from "@/lib/attendance"
import { applyMonthlyXpRewards } from "@/lib/period-rewards"
import { logAudit } from "@/lib/audit"

// GET → the caller's recent period rewards (tier + perk per month).
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const prisma = (await import("@/lib/prisma")).default
  const rewards = await prisma.periodReward.findMany({
    where: { userId: session.user.id, tier: { not: "NONE" } },
    orderBy: { periodKey: "desc" },
    take: 6,
    select: { periodKey: true, tier: true, perk: true, bonusDayOff: true, zeroAlpha: true, finalScore: true },
  })
  return NextResponse.json({ rewards })
}

// POST { monthKey? } → evaluate a completed attendance month: zero-alpha bonus + tier
// rewards. Gated to BoD (canManageAttendance) or the CRON_SECRET header.
export async function POST(req: NextRequest) {
  try {
    const cronSecret = req.headers.get("x-cron-secret")
    const isCron = Boolean(process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET)

    const session = await auth()
    let workspaceId: string | undefined
    let actorId = "cron"

    if (!isCron) {
      if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      const context = await getAttendanceWorkspaceContext(session.user.id)
      if (!context.workspace) return NextResponse.json({ error: "No workspace" }, { status: 404 })
      if (!context.canManageAttendance) return NextResponse.json({ error: "Cuma BoD yang bisa jalanin reward periode" }, { status: 403 })
      workspaceId = context.workspace.id
      actorId = session.user.id
    }

    const body = await req.json().catch(() => ({}))
    const monthKey: string = typeof body?.monthKey === "string" && /^\d{4}-\d{2}$/.test(body.monthKey)
      ? body.monthKey
      : formatAttendanceDateKey(new Date()).slice(0, 7)

    // Cron with no explicit workspace → run all workspaces that have office locations.
    if (isCron && !workspaceId) {
      const ws = await import("@/lib/prisma").then((m) => m.default.workspace.findMany({ select: { id: true } }))
      const results = []
      for (const w of ws) results.push(await applyMonthlyXpRewards(w.id, monthKey))
      return NextResponse.json({ monthKey, results })
    }

    const result = await applyMonthlyXpRewards(workspaceId!, monthKey)
    if (actorId !== "cron") {
      logAudit({ action: "grant", entityType: "period_rewards", entityId: workspaceId!, entityName: `period-rewards:${monthKey}`, userId: actorId, request: req, metadata: { ...result } })
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error("Period rewards error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
