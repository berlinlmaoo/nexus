export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getAttendanceWorkspaceContext, formatAttendanceDateKey } from "@/lib/attendance"
import { refundXpByReason } from "@/lib/gamification"

// ONE-TIME maintenance: refund attendance penalties (late / no-checkout / alpha) that were wrongly
// applied for workdays BEFORE a member joined the workspace. The nightly absence cron used to floor its
// 14-day window only at the global go-live date — so a member created mid-window got back-dated
// absences for days they weren't employed yet. The cron is now fixed (per-member join-day floor); this
// endpoint cleans up the already-applied bogus penalties + drops the matching auto day-offs.
//
// Auth: CRON_SECRET bearer OR a logged-in attendance admin. Idempotent (refundXpByReason no-ops once a
// reason is already refunded). Pass ?dryRun=1 to preview without writing.
const PEN_RE = /^attendance:(?:late|nocheckout|alpha):(\d{4}-\d{2}-\d{2})$/

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    let authorized = false
    if (cronSecret && bearer && bearer === cronSecret) {
      authorized = true
    } else {
      const session = await auth()
      if (session?.user?.id) {
        const ctx = await getAttendanceWorkspaceContext(session.user.id)
        if (ctx.canManageAttendance) authorized = true
      }
    }
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const dryRun = req.nextUrl.searchParams.get("dryRun") === "1"

    const members = await prisma.workspaceMember.findMany({
      select: { userId: true, workspaceId: true, joinedAt: true, user: { select: { name: true, createdAt: true } } },
    })

    const summary: Array<{ name: string | null; workspaceId: string; joinKey: string; dates: string[]; xpRefunded: number; dayOffsDropped: number }> = []
    let totalDates = 0
    let totalXp = 0
    let totalDropped = 0

    for (const m of members) {
      const joinKey = formatAttendanceDateKey(m.joinedAt ?? m.user?.createdAt ?? new Date())

      const txns = await prisma.xpTransaction.findMany({
        where: { userId: m.userId, reason: { startsWith: "attendance:" } },
        select: { reason: true },
      })
      const preJoin = new Set<string>()
      for (const t of txns) {
        const mt = PEN_RE.exec(t.reason)
        if (mt && mt[1] < joinKey) preJoin.add(mt[1])
      }
      if (preJoin.size === 0) continue
      const dates = [...preJoin].sort()
      totalDates += dates.length

      if (dryRun) {
        summary.push({ name: m.user?.name ?? null, workspaceId: m.workspaceId, joinKey, dates, xpRefunded: 0, dayOffsDropped: 0 })
        continue
      }

      let xpHere = 0
      let dropHere = 0
      for (const dk of dates) {
        for (const kind of ["late", "nocheckout", "alpha"] as const) {
          xpHere += await refundXpByReason(m.userId, `attendance:${kind}:${dk}`)
        }
        // Drop the cron's own auto-deduction day-off for that date (reason carries the date key).
        const dropped = await prisma.attendanceRequest.deleteMany({
          where: {
            userId: m.userId,
            workspaceId: m.workspaceId,
            type: "DAY_OFF",
            reviewedById: null,
            approvalSource: "ADMIN",
            reason: { startsWith: "Auto:", contains: dk },
          },
        })
        dropHere += dropped.count
      }
      totalXp += xpHere
      totalDropped += dropHere
      summary.push({ name: m.user?.name ?? null, workspaceId: m.workspaceId, joinKey, dates, xpRefunded: xpHere, dayOffsDropped: dropHere })
    }

    return NextResponse.json({
      dryRun,
      membersFixed: summary.length,
      totalDates,
      totalXpRefunded: totalXp,
      totalDayOffsDropped: totalDropped,
      summary,
    })
  } catch (error) {
    console.error("fix-prejoin-penalties error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
