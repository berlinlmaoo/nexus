export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

// Mark an announcement as seen/dismissed by the current user (so it won't pop up again).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    await prisma.announcementSeen.upsert({
      where: { announcementId_userId: { announcementId: id, userId: session.user.id } },
      create: { announcementId: id, userId: session.user.id },
      update: {},
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("announcement seen error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
