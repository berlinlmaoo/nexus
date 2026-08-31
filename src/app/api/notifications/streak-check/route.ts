export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { notifyStreakAtRisk } from "@/lib/notification-service"
import { getAttendanceDate } from "@/lib/attendance"

/**
 * Nudge people whose streak lapses at midnight.
 *
 * Meant to run once in the evening (crontab: `0 14 * * *` UTC = 21:00 WIB). "Active today" is read
 * off `UserStreak.lastActivityDay`, the same field the streak itself is computed from, so this can
 * never disagree with what the app shows.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
    if (bearer !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const today = getAttendanceDate()
    const startOfToday = new Date(today)
    startOfToday.setHours(0, 0, 0, 0)

    const atRisk = await prisma.userStreak.findMany({
      where: {
        currentStreak: { gt: 0 },
        OR: [{ lastActivityDay: null }, { lastActivityDay: { lt: startOfToday } }],
      },
      select: { userId: true, currentStreak: true },
    })

    let sent = 0
    for (const row of atRisk) {
      // One nudge per person per day, even if this route is run twice.
      const already = await prisma.notification.findFirst({
        where: { userId: row.userId, type: "streak_at_risk", createdAt: { gte: startOfToday } },
        select: { id: true },
      })
      if (already) continue
      await notifyStreakAtRisk({ userId: row.userId, currentStreak: row.currentStreak })
      sent++
    }

    return NextResponse.json({ ok: true, candidates: atRisk.length, sent })
  } catch (error) {
    console.error("streak-check error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
