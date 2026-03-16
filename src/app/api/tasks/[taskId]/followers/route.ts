import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const followers = await prisma.taskFollower.findMany({
      where: { taskId: params.taskId },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })

    const isFollowing = followers.some(f => f.userId === session.user.id)

    return NextResponse.json({ followers, isFollowing })
  } catch (error) {
    console.error("Error fetching followers:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Toggle follow
    const existing = await prisma.taskFollower.findUnique({
      where: { taskId_userId: { taskId: params.taskId, userId: session.user.id } },
    })

    if (existing) {
      await prisma.taskFollower.delete({ where: { id: existing.id } })
      return NextResponse.json({ following: false })
    }

    await prisma.taskFollower.create({
      data: { taskId: params.taskId, userId: session.user.id },
    })

    return NextResponse.json({ following: true }, { status: 201 })
  } catch (error) {
    console.error("Error toggling follow:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
