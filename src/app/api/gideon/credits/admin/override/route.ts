export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { isOrgBodPlus } from "@/lib/org"
import { logAudit } from "@/lib/audit"
import { auditDiff } from "@/lib/audit-describe"
import { MAX_LIMIT, creditSummary } from "@/lib/gideon-credits"
import { emitGideonCredits } from "@/lib/socket-emitter"

/**
 * PUT /api/gideon/credits/admin/override — one person's own GIDEON credit limits (BoD / One Above All).
 *   { userId, dailyLimit: number|null, monthlyLimit: number|null, unlimited: boolean|null, note?: string }
 * null = follow the role default. All three null removes the override. Audited; the person's meter
 * redraws at once (socket `gideon-credits`).
 */
export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await isOrgBodPlus(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const userId = typeof body?.userId === "string" ? body.userId.slice(0, 40) : ""
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const limit = (v: unknown): number | null | "bad" => {
    if (v === null || v === undefined || v === "") return null
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_LIMIT) return "bad"
    return v
  }
  const dailyLimit = limit(body?.dailyLimit)
  const monthlyLimit = limit(body?.monthlyLimit)
  if (dailyLimit === "bad" || monthlyLimit === "bad") {
    return NextResponse.json({ error: `Limits must be whole numbers between 0 and ${MAX_LIMIT}` }, { status: 400 })
  }
  const unlimited = body?.unlimited === true ? true : body?.unlimited === false ? false : null
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) || null : null

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
    if (!user) return NextResponse.json({ error: "Person not found" }, { status: 404 })
    const before = await prisma.gideonCreditOverride.findUnique({ where: { userId } })
    const clearing = dailyLimit === null && monthlyLimit === null && unlimited === null
    if (clearing) {
      await prisma.gideonCreditOverride.deleteMany({ where: { userId } })
    } else {
      await prisma.gideonCreditOverride.upsert({
        where: { userId },
        create: { userId, dailyLimit, monthlyLimit, unlimited, note, updatedById: session.user.id },
        update: { dailyLimit, monthlyLimit, unlimited, note, updatedById: session.user.id },
      })
    }
    await logAudit({
      action: clearing ? "GIDEON_CREDITS_OVERRIDE_CLEARED" : "GIDEON_CREDITS_OVERRIDE_SET",
      entityType: "GideonCredits",
      entityId: userId,
      entityName: `GIDEON credits · ${user.name || userId}`,
      userId: session.user.id,
      metadata: {
        targetUserId: userId,
        changes: auditDiff(
          { dailyLimit: before?.dailyLimit ?? null, monthlyLimit: before?.monthlyLimit ?? null, unlimited: before?.unlimited ?? null, note: before?.note ?? null },
          { dailyLimit, monthlyLimit, unlimited, note: clearing ? null : note },
        ),
      },
      request: req,
    })
    const summary = await creditSummary(userId)
    emitGideonCredits(userId, summary)
    return NextResponse.json({ ok: true, summary })
  } catch (error) {
    console.error("gideon credits override error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
