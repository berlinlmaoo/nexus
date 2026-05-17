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
      await prisma.favorite.delete({ where: { id: existing.id } })
      return NextResponse.json({ favorited: false })
    }

    const favorite = await prisma.favorite.create({
      data: { type, targetId, userId: session.user.id },
    })

    return NextResponse.json({ favorited: true, favorite }, { status: 201 })
  } catch (error) {
    console.error("Error toggling favorite:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
