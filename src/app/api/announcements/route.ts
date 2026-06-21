export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

// BoD and above (+ system admin) can post/manage announcements.
async function isBoD(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role === "ADMIN") return true
  const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { role: true } })
  return memberships.some((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL")
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
    return NextResponse.json({
      announcements: announcements.map((a) => ({
        id: a.id, title: a.title, body: a.body, tone: a.tone, active: a.active,
        createdAt: a.createdAt.toISOString(), seenCount: a._count.seenBy,
        targetUserIds: a.targetUserIds, targetCount: a.targetUserIds.length,
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

    const { title, body, tone, targetUserIds } = await req.json()
    if (!title || !body) return NextResponse.json({ error: "title & body required" }, { status: 400 })
    const t = ["info", "success", "warning"].includes(tone) ? tone : "info"

    // Audience: empty = everyone. Otherwise restrict to the given (real, deduped) workspace members.
    let targets: string[] = []
    if (Array.isArray(targetUserIds) && targetUserIds.length) {
      const wanted = [...new Set(targetUserIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0))]
      const valid = await prisma.workspaceMember.findMany({ where: { userId: { in: wanted } }, select: { userId: true }, distinct: ["userId"] })
      targets = valid.map((v) => v.userId)
    }

    const announcement = await prisma.announcement.create({
      data: { title: String(title).trim(), body: String(body).trim(), tone: t, active: true, createdById: session.user.id, targetUserIds: targets },
    })
    return NextResponse.json({ announcement }, { status: 201 })
  } catch (error) {
    console.error("announcement create error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
