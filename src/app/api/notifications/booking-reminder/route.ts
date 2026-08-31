export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { notifyBookingSoon } from "@/lib/notification-service"

const LEAD_MINUTES = 15

/**
 * Remind whoever booked a room, shortly before it starts.
 *
 * Meant to run every few minutes (crontab: `*\/5 * * * *`). The window is "starts within the next
 * LEAD_MINUTES", and the de-dupe is the booking id carried in the notification's link - so a
 * booking is announced exactly once no matter how often this runs or how the schedule shifts.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
    if (bearer !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const now = new Date()
    const until = new Date(now.getTime() + LEAD_MINUTES * 60_000)

    const soon = await prisma.roomBooking.findMany({
      where: { status: "ACTIVE", startsAt: { gt: now, lte: until } },
      select: { id: true, room: true, title: true, startsAt: true, createdById: true },
    })

    let sent = 0
    for (const booking of soon) {
      const already = await prisma.notification.findFirst({
        where: { userId: booking.createdById, type: "booking_soon", link: { contains: booking.id } },
        select: { id: true },
      })
      if (already) continue

      const minutes = Math.max(1, Math.round((booking.startsAt.getTime() - now.getTime()) / 60_000))
      await notifyBookingSoon({
        userId: booking.createdById,
        bookingId: booking.id,
        room: booking.room,
        title: booking.title,
        minutes,
      })
      sent++
    }

    return NextResponse.json({ ok: true, upcoming: soon.length, sent })
  } catch (error) {
    console.error("booking-reminder error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
