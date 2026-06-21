export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

// Active announcements the logged-in user hasn't dismissed yet → drives the pop-up.
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ announcements: [] })

    const me = session.user.id
    const announcements = await prisma.announcement.findMany({
      where: {
        active: true,
        seenBy: { none: { userId: me } },
        // Audience: shown to everyone (empty target) OR only the targeted users.
        OR: [{ targetUserIds: { isEmpty: true } }, { targetUserIds: { has: me } }],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, body: true, tone: true, imageUrl: true, createdAt: true },
    })
    return NextResponse.json({ announcements })
  } catch (error) {
    console.error("announcements active error:", error)
    return NextResponse.json({ announcements: [] })
  }
}
