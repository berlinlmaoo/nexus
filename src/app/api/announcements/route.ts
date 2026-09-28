export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID, orgRoleOf } from "@/lib/org"
import { notifyAnnouncement } from "@/lib/notification-service"

// BoD and above (+ system admin) can post/manage announcements.
async function isBoD(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role === "ADMIN") return true
  // Company workspace only: every sign-up is One Above All of their own personal workspace.
  const role = await orgRoleOf(userId)
  return role === "BOD" || role === "ONE_ABOVE_ALL"
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { seenBy: true } } },
    })
    const targetIds = [...new Set(announcements.flatMap((a) => a.targetUserIds))]
    const targetUsers = targetIds.length
      ? await prisma.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, name: true } })
      : []
    const nameOf = new Map(targetUsers.map((u) => [u.id, u.name] as const))
    return NextResponse.json({
      announcements: announcements.map((a) => ({
        id: a.id, title: a.title, body: a.body, tone: a.tone, active: a.active,
        kind: a.kind, imageUrl: a.imageUrl, attachmentUrl: a.attachmentUrl, attachmentName: a.attachmentName,
        createdAt: a.createdAt.toISOString(), seenCount: a._count.seenBy,
        // seenCount is per REPEAT, not for all time: a repeat clears the seen rows so the pop-up
        // comes back, which also makes this the more useful number — how many have seen it since
        // it last went out.
        repeatUntil: a.repeatUntil?.toISOString() ?? null,
        repeatAtTime: a.repeatAtTime ?? null,
        lastRepeatedAt: a.lastRepeatedAt?.toISOString() ?? null,
        targetUserIds: a.targetUserIds, targetCount: a.targetUserIds.length,
        targets: a.targetUserIds.map((id) => ({ id, name: nameOf.get(id) ?? null })),
      })),
    })
  } catch (error) {
    console.error("announcements list error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { title, body, tone, targetUserIds, repeatDays, repeatAtTime, kind, attachmentUrl, attachmentName } = await req.json()
    if (!title || !body) return NextResponse.json({ error: "title & body required" }, { status: 400 })
    const t = ["info", "success", "warning"].includes(tone) ? tone : "info"

    // Attachment: only a PDF uploaded through POST /api/announcements/attachment (so the URL is
    // ours, not a link to anywhere). kind "sp" (surat peringatan) needs one; "warning" is only ever
    // created by Absen Monitor's warn route, never here.
    const k = kind === "sp" ? "sp" : "announcement"
    const url = typeof attachmentUrl === "string" && attachmentUrl.trim() ? attachmentUrl.trim() : null
    if (url && !/^\/api\/files\/attachments\/announcements\/[A-Za-z0-9._-]+\.pdf$/.test(url)) {
      return NextResponse.json({ error: "Lampiran tidak valid — unggah PDF-nya lewat tombol Attach PDF." }, { status: 422 })
    }
    if (k === "sp" && !url) return NextResponse.json({ error: "SP butuh lampiran PDF." }, { status: 422 })
    const attName = url
      ? (typeof attachmentName === "string" && attachmentName.trim() ? attachmentName.trim().slice(0, 120) : "SP.pdf")
      : null

    // Repeat, optional. `repeatDays` counts the days AFTER today that it should come back, so 0 (or
    // absent) is the old behaviour exactly: posted once, never repeated. Capped at 30 — a notice
    // that repeats for longer than a month has stopped being a notice.
    const days = Math.min(Math.max(Number(repeatDays) || 0, 0), 30)
    const timeRaw = typeof repeatAtTime === "string" ? repeatAtTime.trim() : ""
    const timeOk = /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeRaw)
    if (days > 0 && !timeOk) {
      return NextResponse.json({ error: "Jam pengulangan harus format HH:mm (24 jam)." }, { status: 422 })
    }
    // 00:00 WIB of the last day it should fire. Built from the Jakarta calendar day rather than
    // "now + N×24h": an announcement posted at 23:50 must still repeat on N further DAYS, not be a
    // few minutes short of the last one.
    let repeatUntil: Date | null = null
    if (days > 0) {
      const jakartaToday = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }))
      jakartaToday.setHours(0, 0, 0, 0)
      repeatUntil = new Date(jakartaToday.getTime() + days * 24 * 60 * 60 * 1000)
    }

    // Audience: empty = everyone. Otherwise restrict to the given (real, deduped) members of the
    // company workspace. A list that matches nobody is refused: falling back to "everyone" would
    // turn one person's SP into a company-wide pop-up.
    let targets: string[] = []
    if (Array.isArray(targetUserIds) && targetUserIds.length) {
      const wanted = [...new Set(targetUserIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0))]
      const valid = await prisma.workspaceMember.findMany({ where: { userId: { in: wanted }, workspaceId: ORG_WORKSPACE_ID }, select: { userId: true }, distinct: ["userId"] })
      targets = valid.map((v) => v.userId)
      if (targets.length === 0) return NextResponse.json({ error: "Orang yang dipilih tidak ditemukan." }, { status: 422 })
    }

    const announcement = await prisma.announcement.create({
      data: {
        title: String(title).trim(), body: String(body).trim(), tone: t, active: true,
        createdById: session.user.id, targetUserIds: targets,
        kind: k, attachmentUrl: url, attachmentName: attName,
        repeatUntil,
        repeatAtTime: repeatUntil ? timeRaw : null,
        // Stamped now so today's repeat window is already spent: the push below IS today's
        // delivery, and the cron must not send it a second time this evening.
        lastRepeatedAt: repeatUntil ? new Date() : null,
      },
    })
    // Awaited, not fired and forgotten: delivery IS the feature here, and a broadcast that quietly
    // failed would leave the person who posted it believing everybody had been told. Wrapped so a
    // push outage cannot undo an announcement that is already saved.
    try {
      await notifyAnnouncement(announcement.id)
    } catch (error) {
      console.error("announcement notify failed:", error)
    }

    return NextResponse.json({ announcement }, { status: 201 })
  } catch (error) {
    console.error("announcement create error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
