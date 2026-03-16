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

    const [count, userLike] = await Promise.all([
      prisma.taskLike.count({ where: { taskId: params.taskId } }),
      prisma.taskLike.findUnique({
        where: { taskId_userId: { taskId: params.taskId, userId: session.user.id } },
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
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const task = await prisma.task.findUnique({ where: { id: params.taskId } })
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

    const existing = await prisma.taskLike.findUnique({
      where: { taskId_userId: { taskId: params.taskId, userId: session.user.id } },
    })

    if (existing) {
      // Unlike
      await prisma.taskLike.delete({
        where: { taskId_userId: { taskId: params.taskId, userId: session.user.id } },
      })
      const count = await prisma.taskLike.count({ where: { taskId: params.taskId } })
      return NextResponse.json({ liked: false, count })
    } else {
      // Like
      await prisma.taskLike.create({
        data: { taskId: params.taskId, userId: session.user.id },
      })
      const count = await prisma.taskLike.count({ where: { taskId: params.taskId } })
      return NextResponse.json({ liked: true, count })
    }
  } catch (error) {
    console.error("Error toggling task like:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
