import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const searchParams = request.nextUrl.searchParams
    const projectId = searchParams.get("projectId")
    const taskId = searchParams.get("taskId")
    const limit = parseInt(searchParams.get("limit") || "20", 10)

    const where: Record<string, unknown> = {}

    if (projectId) {
      where.projectId = projectId
    }
    if (taskId) {
      where.taskId = taskId
    }

    const activityLogs = await prisma.activityLog.findMany({
      where,
      include: {
        user: true,
        task: true,
        project: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    })

    return NextResponse.json(activityLogs)
  } catch (error) {
    console.error("Error fetching activity logs:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
