import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getLeaderboardPeriodStart } from "@/lib/gamification"
import {
  formatAttendanceDateKey,
  getAttendanceDate,
  minutesLateAgainstShift,
  resolveEffectiveAttendanceShift,
  safeAttendanceTimezone,
} from "@/lib/attendance"

const LATE_PREFIX = "attendance:late:"

// Admin-only XP audit log: every XP change (+/-) across all crew the caller shares
// a workspace with. Visible to BoD and above (+ system admin) only — it exposes
// per-person penalty data (alpha, late, no-checkout) which is HR-sensitive.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
    const isSysAdmin = me?.role === "ADMIN"

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: session.user.id },
      select: { workspaceId: true, role: true },
    })
    const isBoD = memberships.some((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL")
    if (!isSysAdmin && !isBoD) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Peers = everyone the caller shares a workspace with (same scope as leaderboard).
    const workspaceIds = memberships.map((m) => m.workspaceId)
    if (workspaceIds.length === 0) return NextResponse.json({ rows: [], hasMore: false, nextOffset: 0 })
    const peers = await prisma.workspaceMember.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { userId: true },
      distinct: ["userId"],
    })
    const userIds = Array.from(new Set(peers.map((p) => p.userId)))

    const sp = req.nextUrl.searchParams
    const scope = sp.get("scope") === "all" ? "all" : "period"
    const signParam = sp.get("sign")
    const sign = signParam === "pos" || signParam === "neg" ? signParam : "all"
    const filterUserId = sp.get("userId")
    const limit = Math.max(1, Math.min(100, Number(sp.get("limit")) || 50))
    const offset = Math.max(0, Number(sp.get("offset")) || 0)

    const amountFilter = sign === "pos" ? { gt: 0 } : sign === "neg" ? { lt: 0 } : undefined
    const targetUser = filterUserId && userIds.includes(filterUserId) ? filterUserId : null

    const where = {
      userId: targetUser ? targetUser : { in: userIds },
      ...(scope === "period" ? { createdAt: { gte: getLeaderboardPeriodStart() } } : {}),
      ...(amountFilter ? { amount: amountFilter } : {}),
    }

    const txns = await prisma.xpTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        userId: true,
        amount: true,
        reason: true,
        createdAt: true,
        user: { select: { name: true, avatar: true } },
      },
    })

    const hasMore = txns.length > limit
    const page = hasMore ? txns.slice(0, limit) : txns

    // Enrich attendance:late rows with the EXACT (uncapped) late minutes. The XP penalty is
    // -min(lateMinutes, 120), so |amount| can't show ">120 min". Source of truth: the checked-in
    // record's stored lateMinutes; for those still NOT checked in (live accrual today), compute
    // elapsed = now − shift start (same math the accrual cron uses).
    const lateMinutesByTxn = new Map<string, number>()
    const lateTxns = page.filter((t) => t.reason.startsWith(LATE_PREFIX))
    if (lateTxns.length > 0) {
      const dateKeys = [...new Set(lateTxns.map((t) => t.reason.slice(LATE_PREFIX.length)))]
      const records = await prisma.attendanceRecord.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          userId: { in: [...new Set(lateTxns.map((t) => t.userId))] },
          attendanceDate: { in: dateKeys.map((d) => new Date(`${d}T00:00:00.000Z`)) },
        },
        select: { userId: true, workspaceId: true, attendanceDate: true, checkInAt: true, lateMinutes: true },
      })
      const recByKey = new Map(records.map((r) => [`${r.userId}:${r.attendanceDate.toISOString().slice(0, 10)}`, r]))

      const todayDate = getAttendanceDate()
      const todayKey = formatAttendanceDateKey(todayDate)
      const now = new Date()
      let officeByWorkspace: Map<string, Awaited<ReturnType<typeof prisma.officeLocation.findMany>>[number]> | null = null

      for (const t of lateTxns) {
        const dk = t.reason.slice(LATE_PREFIX.length)
        const rec = recByKey.get(`${t.userId}:${dk}`)
        if (rec?.checkInAt) {
          // Checked in → FINAL. Use the record's exact minutes; never live-compute for someone who
          // already checked in (that wrongly showed "now − shift start" for on-time-within-grace people).
          if ((rec.lateMinutes ?? 0) > 0) lateMinutesByTxn.set(t.id, rec.lateMinutes as number)
          continue
        }
        // Not checked in → live elapsed (only today's penalties are still accruing).
        if (dk !== todayKey) continue
        if (!officeByWorkspace) {
          const offices = await prisma.officeLocation.findMany({ where: { isActive: true } })
          officeByWorkspace = new Map()
          for (const o of offices) if (!officeByWorkspace.has(o.workspaceId)) officeByWorkspace.set(o.workspaceId, o)
        }
        const wsId = rec?.workspaceId ?? workspaceIds[0]
        const office = officeByWorkspace.get(wsId)
        if (!office) continue
        try {
          const shift = await resolveEffectiveAttendanceShift({ userId: t.userId, workspaceId: wsId, office, date: todayDate })
          const elapsed = minutesLateAgainstShift(now, todayDate, shift.shiftStartTime, safeAttendanceTimezone(office.timezone))
          if (elapsed > 0) lateMinutesByTxn.set(t.id, elapsed)
        } catch {
          /* shift unresolved → skip; frontend falls back to the capped |amount| */
        }
      }
    }

    const rows = page.map((t) => ({
      id: t.id,
      userId: t.userId,
      userName: t.user?.name ?? null,
      userAvatar: t.user?.avatar ?? null,
      amount: t.amount,
      reason: t.reason,
      createdAt: t.createdAt.toISOString(),
      lateMinutes: lateMinutesByTxn.has(t.id) ? lateMinutesByTxn.get(t.id) : null,
    }))

    return NextResponse.json({ rows, hasMore, nextOffset: offset + page.length, scope, sign })
  } catch (error) {
    console.error("xp-transactions GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
