export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const favorites = await prisma.favorite.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(favorites)
  } catch (error) {
    console.error("Error fetching favorites:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { type, targetId } = await request.json()

    if (!type || !targetId) {
      return NextResponse.json({ error: "type and targetId are required" }, { status: 400 })
    }

    // Toggle: if exists, remove; if not, create
    const existing = await prisma.favorite.findUnique({
      where: { userId_type_targetId: { userId: session.user.id, type, targetId } },
    })

    if (existing) {
      // deleteMany: a concurrent toggle may have removed it already (delete would throw P2025 → 500).
      await prisma.favorite.deleteMany({ where: { id: existing.id } })
      return NextResponse.json({ favorited: false })
    }

    let favorite
    try {
      favorite = await prisma.favorite.create({
        data: { type, targetId, userId: session.user.id },
      })
    } catch (e) {
      // A concurrent toggle (double click) created it a moment ago: it is favorited, not a 500.
      if ((e as { code?: string })?.code !== "P2002") throw e
      favorite = await prisma.favorite.findUniqueOrThrow({ where: { userId_type_targetId: { userId: session.user.id, type, targetId } } })
    }

    return NextResponse.json({ favorited: true, favorite }, { status: 201 })
  } catch (error) {
    console.error("Error toggling favorite:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
