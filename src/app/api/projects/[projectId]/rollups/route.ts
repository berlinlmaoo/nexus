export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Get all tasks for this project
    const tasks = await prisma.task.findMany({
      where: {
        taskList: { projectId: params.projectId },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    const totalTasks = tasks.length
    const completedTasks = tasks.filter((t) => t.status === "DONE").length
    const completionPercent =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    // Average completion time (days) for completed tasks
    const completedWithTimes = tasks.filter((t) => t.status === "DONE")
    let avgCompletionDays = 0
    if (completedWithTimes.length > 0) {
      const totalDays = completedWithTimes.reduce((sum, t) => {
        const created = new Date(t.createdAt).getTime()
        const updated = new Date(t.updatedAt).getTime()
        return sum + (updated - created) / (1000 * 60 * 60 * 24)
      }, 0)
      avgCompletionDays = Math.round(totalDays / completedWithTimes.length)
    }

    return NextResponse.json({
      totalTasks,
      completedTasks,
      completionPercent,
      avgCompletionDays,
    })
  } catch (error) {
    console.error("Error fetching project rollups:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
