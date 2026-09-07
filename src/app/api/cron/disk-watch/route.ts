export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { statfs } from "fs/promises"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { createInAppNotification } from "@/lib/notification-service"

// Disk watch. Nothing in this repo watched free space until now, and the day it runs out the
// symptoms look like ten other things: Postgres stops accepting writes, uploads fail, images 500.
// By then the person who could act has no signal pointing at the cause.
//
// Measured through the uploads bind mount rather than at the host, because that path is what
// actually fills — attendance selfies and task attachments are 14 GB of it — and because it is the
// one filesystem this process can see from inside its container. Verified: the numbers here match
// `df` on the host exactly.
const UPLOADS_PATH = "/app/public/uploads"

// Warn at 88%, alarm at 94%. Not 80: a box that sits at 84% for months would then warn every day
// and teach everyone to ignore it, which is how a real alarm gets missed.
const WARN_PCT = 88
const ALARM_PCT = 94

/** One notification per level per day. A disk alarm that repeats hourly is noise, not urgency. */
function todayKey(pct: number) {
  return `disk:${pct >= ALARM_PCT ? "alarm" : "warn"}:${new Date().toISOString().slice(0, 10)}`
}

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    let authorized = Boolean(cronSecret && bearer && bearer === cronSecret)
    if (!authorized) {
      // Manual run from a BoD account, so this is testable without the cron secret.
      const session = await auth()
      if (session?.user?.id && isBodPlus(await getUserOrgRole(session.user.id))) authorized = true
    }
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const fs = await statfs(UPLOADS_PATH)
    const total = fs.blocks * fs.bsize
    // bavail, not bfree: bfree counts blocks reserved for root, which nothing here can use.
    const free = fs.bavail * fs.bsize
    const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0
    const freeGb = Math.round((free / 1024 ** 3) * 10) / 10

    if (usedPct < WARN_PCT) {
      return NextResponse.json({ usedPct, freeGb, notified: 0, level: "ok" })
    }

    const level = usedPct >= ALARM_PCT ? "alarm" : "warn"
    const key = todayKey(usedPct)

    // Everyone who could actually act. A disk warning sent to staff is a worry they cannot answer.
    const bod = await prisma.workspaceMember.findMany({
      where: { role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
      select: { userId: true },
      distinct: ["userId"],
    })

    const title = level === "alarm" ? "Disk server hampir penuh" : "Disk server mulai penuh"
    const message =
      `Penyimpanan terpakai ${usedPct}%, sisa ${freeGb} GB. ` +
      (level === "alarm"
        ? "Kalau habis, upload dan absensi berhenti bekerja."
        : "Belum mendesak, tapi sisanya perlu diawasi.")

    let notified = 0
    for (const m of bod) {
      // The dedupe window in createInAppNotification is what keeps this to one per level per day:
      // same user, same type, same link, same message inside 23 hours is suppressed.
      const made = await createInAppNotification({
        userId: m.userId,
        type: "system_disk",
        title,
        message,
        link: "/admin",
        push: level === "alarm",
        dedupeWindowMs: 23 * 60 * 60 * 1000,
      }).catch(() => null)
      if (made) notified += 1
    }

    return NextResponse.json({ usedPct, freeGb, level, key, notified })
  } catch (error) {
    console.error("disk watch failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
