export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { awardXp } from "@/lib/gamification"

const MAX_ABS = 1000

// BoD-only manual XP adjustment (add OR reduce). Creates a single XpTransaction
// (reason "admin:adjust" or "admin:adjust:<note>") and updates UserXp + level via awardXp.
// Negative amounts feed the staff "XP berkurang" popup (kind "admin").
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, name: true } })
    const isSysAdmin = me?.role === "ADMIN"
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: session.user.id },
      select: { workspaceId: true, role: true },
    })
    const isBoD = memberships.some((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL")
    if (!isSysAdmin && !isBoD) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const workspaceIds = memberships.map((m) => m.workspaceId)

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
    const dup = await prisma.xpTransaction.findFirst({
      where: { userId, reason, amount, createdAt: { gte: new Date(Date.now() - 10_000) } },
      select: { id: true },
    })
    if (dup) {
      const cur = await prisma.userXp.findUnique({ where: { userId }, select: { totalXp: true, currentLevel: true } })
      return NextResponse.json({ ok: true, duplicate: true, totalXp: cur?.totalXp ?? null, currentLevel: cur?.currentLevel ?? null })
    }

    await awardXp(userId, amount, reason)

    const xp = await prisma.userXp.findUnique({ where: { userId }, select: { totalXp: true, currentLevel: true } })
    return NextResponse.json({ ok: true, totalXp: xp?.totalXp ?? null, currentLevel: xp?.currentLevel ?? null })
  } catch (error) {
    console.error("xp-adjust POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
