export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { notifyQuotaLow } from "@/lib/notification-service"
import {
  attendancePeriodKey,
  attendancePeriodRange,
  endOfAttendanceMonth,
  formatAttendanceDateKey,
  startOfAttendanceMonth,
} from "@/lib/attendance"

/** Days a request covers inside a window, counting both end days. */
function daysInWindow(startDate: Date, endDate: Date, windowStart: Date, windowEnd: Date) {
  const from = Math.max(startDate.getTime(), windowStart.getTime())
  const to = Math.min(endDate.getTime(), windowEnd.getTime())
  return Math.max(0, Math.floor((to - from) / 86_400_000) + 1)
}

/**
 * Warn people who have one day of allowance left this month.
 *
 * Meant to run once a day (crontab: `0 2 * * *` UTC = 09:00 WIB). The usage maths deliberately
 * mirrors `/api/attendance/today` and imports the same period helpers from `@/lib/attendance`,
 * so the number in the notification can never disagree with the number on the screen.
 *
 * "Remaining exactly 1" is the trigger: the next request is the last one, which is the only moment
 * where a heads-up changes what someone does. Firing at 2 or 3 left would train people to ignore it.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
    if (bearer !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const dayOffPeriod = attendancePeriodRange(attendancePeriodKey())
    const monthStart = startOfAttendanceMonth(new Date())
    const monthEnd = endOfAttendanceMonth(new Date())
    const monthKey = formatAttendanceDateKey().slice(0, 7)

    const members = await prisma.workspaceMember.findMany({
      select: { userId: true, workspaceId: true, dayOffQuota: true },
    })

    const redDateQuotas = new Map<string, number>()
    for (const workspaceId of new Set(members.map((m) => m.workspaceId))) {
      const row = await prisma.redDateQuota.findUnique({
        where: { workspaceId_month: { workspaceId, month: monthKey } },
        select: { quota: true },
      })
      if (row?.quota) redDateQuotas.set(workspaceId, row.quota)
    }

    let sent = 0
    for (const member of members) {
      const requests = await prisma.attendanceRequest.findMany({
        where: {
          userId: member.userId,
          workspaceId: member.workspaceId,
          type: { in: ["DAY_OFF", "RED_DATE"] },
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
        select: { type: true, startDate: true, endDate: true },
      })

      const kinds: { kind: "dayoff" | "red_date"; type: string; quota: number; start: Date; end: Date; notifType: string }[] = [
        { kind: "dayoff", type: "DAY_OFF", quota: member.dayOffQuota ?? 0, start: dayOffPeriod.start, end: dayOffPeriod.end, notifType: "dayoff_quota_low" },
        { kind: "red_date", type: "RED_DATE", quota: redDateQuotas.get(member.workspaceId) ?? 0, start: monthStart, end: monthEnd, notifType: "red_date_quota_low" },
      ]

      for (const entry of kinds) {
        if (entry.quota <= 0) continue
        const used = requests
          .filter((r) => r.type === entry.type)
          .reduce((count, r) => count + daysInWindow(r.startDate, r.endDate, entry.start, entry.end), 0)
        const remaining = entry.quota - used
        if (remaining !== 1) continue

        // Once per person per month per kind.
        const already = await prisma.notification.findFirst({
          where: { userId: member.userId, type: entry.notifType, createdAt: { gte: monthStart } },
          select: { id: true },
        })
        if (already) continue

        await notifyQuotaLow({ userId: member.userId, kind: entry.kind, remaining, quota: entry.quota })
        sent++
      }
    }

    return NextResponse.json({ ok: true, members: members.length, sent })
  } catch (error) {
    console.error("quota-check error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
