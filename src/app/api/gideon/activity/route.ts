export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { GIDEON_EMAIL } from "@/lib/gideon-identity"
import { attendanceWallClockToUtc, formatAttendanceDateKey } from "@/lib/attendance"

/**
 * How busy GIDEON is right now — for the public agents page on status.znetworks.id.
 *
 * Counts only, never content, never names: how many answers in the last ten minutes and since
 * midnight WIB, how many tickets it replied to, how many colleagues it helped today. That is what
 * "GIDEON is working" looks like from the outside, and nothing here identifies who asked what.
 * No session: the numbers are the same for everybody and there is nothing in them to protect.
 */
const ORIGIN = "https://status.znetworks.id"
const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Cache-Control": "public, max-age=30",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET" } })
}

export async function GET() {
  try {
    const now = new Date()
    const tenMin = new Date(now.getTime() - 10 * 60 * 1000)
    const dayStart = attendanceWallClockToUtc(formatAttendanceDateKey(now), "00:00") ?? new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const [recentAnswers, todayAnswers, recentTickets, todayTickets, helpedToday, lastAnswer, lastTicket] = await Promise.all([
      prisma.gideonMessage.count({ where: { role: "assistant", createdAt: { gte: tenMin } } }),
      prisma.gideonMessage.count({ where: { role: "assistant", createdAt: { gte: dayStart } } }),
      prisma.complaintMessage.count({ where: { author: { email: GIDEON_EMAIL }, createdAt: { gte: tenMin } } }),
      prisma.complaintMessage.count({ where: { author: { email: GIDEON_EMAIL }, createdAt: { gte: dayStart } } }),
      prisma.gideonMessage.findMany({ where: { role: "user", createdAt: { gte: dayStart } }, distinct: ["userId"], select: { userId: true } }).then((r) => r.length),
      prisma.gideonMessage.findFirst({ where: { role: "assistant" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.complaintMessage.findFirst({ where: { author: { email: GIDEON_EMAIL } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ])
    const lastAt = [lastAnswer?.createdAt, lastTicket?.createdAt].filter(Boolean).sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] ?? null
    return NextResponse.json(
      {
        working: recentAnswers + recentTickets > 0,
        last10min: { answers: recentAnswers, ticketReplies: recentTickets },
        today: { answers: todayAnswers, ticketReplies: todayTickets, peopleHelped: helpedToday },
        lastActivityAt: lastAt,
        generatedAt: now.toISOString(),
      },
      { headers },
    )
  } catch (error) {
    console.error("gideon activity error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers })
  }
}
