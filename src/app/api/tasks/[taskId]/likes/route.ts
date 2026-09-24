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
    // Signed in is not enough (writes batch): whoever may open the task (lib/write-access.ts).
    const refusal = await taskWriteRefusal(session.user.id, (await params).taskId)
    if (refusal) return refusal

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

// DELETE = explicit, idempotent unlike (method-fix 2026-09-24).
// The web task panel (apps/nexus-lovable-ui toggleTaskLike) sends POST to like and DELETE to
// unlike; before this handler existed the DELETE answered 405 and a like could never be removed
// from the web. Unlike POST this never toggles: removing a like that is not there is a no-op.
// Same checks as POST (signed in + task exists). `likeCount` mirrors `count` because that is the
// field name the web client's type declares.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // Signed in is not enough (writes batch): whoever may open the task (lib/write-access.ts).
    const refusal = await taskWriteRefusal(session.user.id, (await params).taskId)
    if (refusal) return refusal

    const { taskId } = await params
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } })
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

    await prisma.taskLike.deleteMany({ where: { taskId, userId: session.user.id } })
    const count = await prisma.taskLike.count({ where: { taskId } })
    return NextResponse.json({ liked: false, count, likeCount: count })
  } catch (error) {
    console.error("Error removing task like:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
