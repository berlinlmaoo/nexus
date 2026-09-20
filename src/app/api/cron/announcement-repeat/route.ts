export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { attendanceWallClockToUtc, formatAttendanceDateKey } from "@/lib/attendance"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { notifyAnnouncement } from "@/lib/notification-service"

// Repeat announcements. An announcement with a `repeatUntil` comes back every day until that date,
// at `repeatAtTime` (Asia/Jakarta), on the web pop-up AND as a push.
//
// The pop-up is brought back by DELETING that announcement's AnnouncementSeen rows rather than by
// counting cycles. /api/announcements/active already asks "has this person dismissed it", so
// clearing the answer is the whole mechanism — no new column, no second definition of "seen" that
// could drift from the first. It also makes seenCount mean "seen since it last went out", which is
// the number a BoD actually wants while a notice is still running.
//
// Runs every quarter hour and fires at most once per Jakarta day per announcement, so the exact
// minute it lands is within fifteen of the hour asked for. That is the right trade for a notice:
// a cron running every minute to hit :00 exactly would be forty times the work for a difference
// nobody reading "wear your ID card today" would notice.

/** Wall-clock Jakarta parts of an instant. The DB stores UTC and the schedule is written in WIB. */
function jakarta(now: Date) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }))
  // A real instant, not Jakarta-midnight-as-UTC (which is 07:00 WIB on this UTC container): compared
  // against `lastRepeatedAt`, that offset made an announcement set before 07:00 fire on every run
  // between its time and seven o'clock.
  const startOfDay = attendanceWallClockToUtc(formatAttendanceDateKey(now), "00:00")
  return { local, startOfDay, minutes: local.getHours() * 60 + local.getMinutes() }
}

function parseHHmm(v: string | null): number | null {
  if (!v) return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    let authorized = Boolean(cronSecret && bearer && bearer === cronSecret)
    if (!authorized) {
      const session = await auth()
      if (session?.user?.id && isBodPlus(await getUserOrgRole(session.user.id))) authorized = true
    }
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: { dryRun?: boolean } | null = null
    try {
      body = (await req.json()) as { dryRun?: boolean }
    } catch {
      // no body
    }
    const dryRun = body?.dryRun === true

    const now = new Date()
    const { startOfDay, minutes } = jakarta(now)

    // Still running today: repeatUntil is 00:00 WIB of the LAST day, so today counts while
    // startOfDay <= repeatUntil.
    const candidates = await prisma.announcement.findMany({
      where: { active: true, repeatUntil: { gte: startOfDay }, repeatAtTime: { not: null } },
      select: { id: true, title: true, repeatAtTime: true, lastRepeatedAt: true, repeatUntil: true },
      take: 50,
    })

    const fired: { id: string; title: string }[] = []
    const skipped: { id: string; why: string }[] = []

    for (const a of candidates) {
      const at = parseHHmm(a.repeatAtTime)
      if (at === null) { skipped.push({ id: a.id, why: "jam tidak valid" }); continue }
      if (minutes < at) { skipped.push({ id: a.id, why: "belum waktunya hari ini" }); continue }
      // Already sent today. Compared against the Jakarta day boundary, not "24 hours ago", or an
      // announcement set for 08:00 would drift later every day and eventually skip one.
      if (a.lastRepeatedAt && a.lastRepeatedAt >= startOfDay) {
        skipped.push({ id: a.id, why: "sudah dikirim hari ini" })
        continue
      }
      if (dryRun) { fired.push({ id: a.id, title: a.title }); continue }

      // Order matters. The stamp goes FIRST: if the notify below throws, this must not become a
      // notice that re-sends on every cron run for the rest of the day.
      await prisma.announcement.update({ where: { id: a.id }, data: { lastRepeatedAt: now } })
      await prisma.announcementSeen.deleteMany({ where: { announcementId: a.id } })
      try {
        await notifyAnnouncement(a.id)
      } catch (err) {
        console.error("announcement repeat: notify failed", { id: a.id, err })
      }
      fired.push({ id: a.id, title: a.title })
    }

    return NextResponse.json({ ok: true, dryRun, checked: candidates.length, fired, skipped })
  } catch (error) {
    console.error("announcement repeat failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
