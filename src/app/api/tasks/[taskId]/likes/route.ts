export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const [count, userLike] = await Promise.all([
      prisma.taskLike.count({ where: { taskId: (await params).taskId } }),
      prisma.taskLike.findUnique({
        where: { taskId_userId: { taskId: (await params).taskId, userId: session.user.id } },
      }),
    ])

    return NextResponse.json({ count, liked: !!userLike })
  } catch (error) {
    console.error("Error fetching task likes:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const task = await prisma.task.findUnique({ where: { id: (await params).taskId } })
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

    const existing = await prisma.taskLike.findUnique({
      where: { taskId_userId: { taskId: (await params).taskId, userId: session.user.id } },
    })

    if (existing) {
      // Unlike
      await prisma.taskLike.delete({
        where: { taskId_userId: { taskId: (await params).taskId, userId: session.user.id } },
      })
      const count = await prisma.taskLike.count({ where: { taskId: (await params).taskId } })
      return NextResponse.json({ liked: false, count })
    } else {
      // Like
      await prisma.taskLike.create({
        data: { taskId: (await params).taskId, userId: session.user.id },
      })
      const count = await prisma.taskLike.count({ where: { taskId: (await params).taskId } })
      return NextResponse.json({ liked: true, count })
    }
  } catch (error) {
    console.error("Error toggling task like:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
