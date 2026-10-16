export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID, orgRoleOf } from "@/lib/org"
import { awardXpTx, periodLevelOf } from "@/lib/gamification"

const MAX_ABS = 1000

// BoD-only manual XP adjustment (add OR reduce). Creates a single XpTransaction
// (reason "admin:adjust" or "admin:adjust:<note>") and updates UserXp + level via awardXp.
// Negative amounts feed the staff "XP berkurang" popup (kind "admin").
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } })
    // BoD+ of the COMPANY workspace only (every sign-up is One Above All of a personal workspace),
    // and the target must be a member of the company workspace too.
    const orgRole = await orgRoleOf(session.user.id)
    const isBoD = orgRole === "BOD" || orgRole === "ONE_ABOVE_ALL"
    if (!isBoD) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const workspaceIds = [ORG_WORKSPACE_ID]

    const body = await req.json().catch(() => null)
    const userId = String(body?.userId ?? "").trim()
    const amount = Math.trunc(Number(body?.amount))
    const note = String(body?.note ?? "").replace(/\s+/g, " ").trim().slice(0, 120)

    if (!userId) return NextResponse.json({ error: "userId wajib diisi" }, { status: 400 })
    if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ error: "Jumlah XP harus angka selain 0" }, { status: 400 })
    if (Math.abs(amount) > MAX_ABS) return NextResponse.json({ error: `Maksimal ±${MAX_ABS} XP per penyesuaian` }, { status: 400 })

    // Target must be someone the caller shares a workspace with.
    const peer = await prisma.workspaceMember.findFirst({
      where: { userId, workspaceId: { in: workspaceIds } },
      select: { userId: true },
    })
    if (!peer) return NextResponse.json({ error: "User di luar workspace kamu" }, { status: 403 })

    // Stamp the acting BoD into the reason for accountability (no schema change). Shown in the
    // audit log + the target's "XP berkurang" popup.
    const actorName = (me?.name ?? "admin").trim()
    const detail = note ? `${note} · oleh ${actorName}` : `oleh ${actorName}`
    const reason = `admin:adjust:${detail}`

    // Idempotency: ignore an identical adjustment that landed in the last 10s (double-click /
    // network retry). Intentional repeats just need a >10s gap or a different note/amount.
    // The check and the insert run in one transaction under a (userId, reason) advisory lock (race audit
    // H4): as two statements, a double-click whose requests overlapped passed the check twice.
    const duplicate = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}|${reason}`})::int8)`
      const dup = await tx.xpTransaction.findFirst({
        where: { userId, reason, amount, createdAt: { gte: new Date(Date.now() - 10_000) } },
        select: { id: true },
      })
      if (dup) return true
      await awardXpTx(tx, userId, amount, reason)
      return false
    })
    if (duplicate) {
      const cur = await prisma.userXp.findUnique({ where: { userId }, select: { totalXp: true } })
      return NextResponse.json({ ok: true, duplicate: true, totalXp: cur?.totalXp ?? null, currentLevel: cur ? await periodLevelOf(userId) : null })
    }

    // currentLevel = this period's level, as the leaderboard and the profile show it (owner, 16 Oct 2026).
    const xp = await prisma.userXp.findUnique({ where: { userId }, select: { totalXp: true } })
    return NextResponse.json({ ok: true, totalXp: xp?.totalXp ?? null, currentLevel: xp ? await periodLevelOf(userId) : null })
  } catch (error) {
    console.error("xp-adjust POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
