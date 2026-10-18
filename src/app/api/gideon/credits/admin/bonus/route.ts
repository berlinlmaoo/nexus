export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { isOrgBodPlus } from "@/lib/org"
import { logAudit } from "@/lib/audit"
import { creditKeys, creditSummary } from "@/lib/gideon-credits"
import { emitGideonCredits } from "@/lib/socket-emitter"

/**
 * One-off bonus GIDEON credits (BoD / One Above All, owner 18 Oct 2026). A bonus is added to the person's
 * monthly pool for the CURRENT period (28th → 27th) and lapses with it, like the pool itself.
 *   GET  ?userId=…                         that person's bonuses, newest first
 *   POST { userId, credits: 1..100000, reason? }   audited; the person's meter redraws at once
 */
const MAX_BONUS = 100_000

async function guard() {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!(await isOrgBodPlus(session.user.id))) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { userId: session.user.id }
}

export async function GET(req: NextRequest) {
  const g = await guard()
  if ("error" in g) return g.error
  const userId = new URL(req.url).searchParams.get("userId")?.slice(0, 40) || ""
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })
  const rows = await prisma.gideonCreditBonus.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 })
  const granters = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.grantedById))] } }, select: { id: true, name: true } })
  const nameOf = new Map(granters.map((u) => [u.id, u.name]))
  return NextResponse.json({ bonuses: rows.map((r) => ({ ...r, grantedByName: nameOf.get(r.grantedById) ?? null })) })
}

export async function POST(req: NextRequest) {
  const g = await guard()
  if ("error" in g) return g.error
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const userId = typeof body?.userId === "string" ? body.userId.slice(0, 40) : ""
  const credits = body?.credits
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })
  if (typeof credits !== "number" || !Number.isInteger(credits) || credits < 1 || credits > MAX_BONUS) {
    return NextResponse.json({ error: `credits must be a whole number between 1 and ${MAX_BONUS}` }, { status: 400 })
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) || null : null
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
    if (!user) return NextResponse.json({ error: "Person not found" }, { status: 404 })
    const { periodKey } = creditKeys()
    const bonus = await prisma.gideonCreditBonus.create({ data: { userId, periodKey, credits, reason, grantedById: g.userId } })
    await logAudit({
      action: "GIDEON_CREDITS_BONUS_GRANTED",
      entityType: "GideonCredits",
      entityId: userId,
      entityName: `GIDEON credits · ${user.name || userId}`,
      userId: g.userId,
      metadata: { targetUserId: userId, credits, periodKey, reason, bonusId: bonus.id },
      request: req,
    })
    const summary = await creditSummary(userId)
    emitGideonCredits(userId, summary)
    return NextResponse.json({ bonus, summary })
  } catch (error) {
    console.error("gideon credits bonus error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
