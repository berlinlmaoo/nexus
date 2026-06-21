export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getLeaderboardPeriodStart } from "@/lib/gamification"

const LATE_PREFIX = "attendance:late:"

// PUBLIC per-user XP log. Any authenticated user can view a workspace peer's XP history
// (gains + penalties, full transparency — the leaderboard "click a person" view). Peer-scoped:
// you can only see people who share a workspace with you. Late penalties get exact minutes.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const targetId = req.nextUrl.searchParams.get("userId")
    if (!targetId) return NextResponse.json({ error: "userId wajib" }, { status: 400 })

    const myWs = await prisma.workspaceMember.findMany({ where: { userId: session.user.id }, select: { workspaceId: true } })
    const workspaceIds = myWs.map((m) => m.workspaceId)
    if (workspaceIds.length === 0) return NextResponse.json({ rows: [], hasMore: false, nextOffset: 0, user: null })

    // Target must share a workspace with the caller (no cross-workspace peeking).
    const peer = await prisma.workspaceMember.findFirst({
      where: { userId: targetId, workspaceId: { in: workspaceIds } },
      select: { user: { select: { id: true, name: true, avatar: true } } },
    })
    if (!peer) return NextResponse.json({ error: "User di luar workspace kamu" }, { status: 403 })

    const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "period"
    const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get("limit")) || 50))
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0)

    const where = {
      userId: targetId,
      ...(scope === "period" ? { createdAt: { gte: getLeaderboardPeriodStart() } } : {}),
    }
    const txns = await prisma.xpTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit + 1,
      select: { id: true, amount: true, reason: true, createdAt: true },
    })
    const hasMore = txns.length > limit
    const page = hasMore ? txns.slice(0, limit) : txns

    // Enrich late rows with exact (uncapped) minutes from the checked-in record (same as the audit log).
    const lateMinutesByTxn = new Map<string, number>()
    const lateTxns = page.filter((t) => t.reason.startsWith(LATE_PREFIX))
    if (lateTxns.length > 0) {
      const dateKeys = [...new Set(lateTxns.map((t) => t.reason.slice(LATE_PREFIX.length)))]
      const recs = await prisma.attendanceRecord.findMany({
        where: { userId: targetId, workspaceId: { in: workspaceIds }, attendanceDate: { in: dateKeys.map((d) => new Date(`${d}T00:00:00.000Z`)) } },
        select: { attendanceDate: true, checkInAt: true, lateMinutes: true },
      })
      const recByDate = new Map(recs.map((r) => [r.attendanceDate.toISOString().slice(0, 10), r]))
      for (const t of lateTxns) {
        const rec = recByDate.get(t.reason.slice(LATE_PREFIX.length))
        if (rec?.checkInAt && (rec.lateMinutes ?? 0) > 0) lateMinutesByTxn.set(t.id, rec.lateMinutes as number)
      }
    }

    const rows = page.map((t) => ({
      id: t.id,
      amount: t.amount,
      reason: t.reason,
      createdAt: t.createdAt.toISOString(),
      lateMinutes: lateMinutesByTxn.has(t.id) ? lateMinutesByTxn.get(t.id) : null,
    }))

    return NextResponse.json({ rows, hasMore, nextOffset: offset + page.length, user: peer.user, scope })
  } catch (error) {
    console.error("xp-log GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
