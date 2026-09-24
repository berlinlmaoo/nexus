export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { taskWriteRefusal } from "@/lib/write-access"
import { canReadTask, taskReadRefusal } from "@/lib/read-access"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // Signed in is not enough (API.md E5): whoever may open the task (lib/read-access.ts).
    const readable = await canReadTask(session.user.id, (await params).taskId)
    if (readable !== "ok") return taskReadRefusal(readable)

    const followers = await prisma.taskFollower.findMany({
      where: { taskId: (await params).taskId },
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
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // Signed in is not enough (writes batch): whoever may open the task (lib/write-access.ts).
    const refusal = await taskWriteRefusal(session.user.id, (await params).taskId)
    if (refusal) return refusal

    // Toggle follow
    const existing = await prisma.taskFollower.findUnique({
      where: { taskId_userId: { taskId: (await params).taskId, userId: session.user.id } },
    })

    if (existing) {
      await prisma.taskFollower.delete({ where: { id: existing.id } })
      return NextResponse.json({ following: false })
    }

    await prisma.taskFollower.create({
      data: { taskId: (await params).taskId, userId: session.user.id },
    })

    return NextResponse.json({ following: true }, { status: 201 })
  } catch (error) {
    console.error("Error toggling follow:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
