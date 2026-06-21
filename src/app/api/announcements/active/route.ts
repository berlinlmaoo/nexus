export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

// Active announcements the logged-in user hasn't dismissed yet → drives the pop-up.
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ announcements: [] })

    const announcements = await prisma.announcement.findMany({
      where: { active: true, seenBy: { none: { userId: session.user.id } } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, body: true, tone: true, createdAt: true },
    })
    return NextResponse.json({ announcements })
  } catch (error) {
    console.error("announcements active error:", error)
    return NextResponse.json({ announcements: [] })
  }
}
