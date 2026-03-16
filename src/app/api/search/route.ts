import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const q = request.nextUrl.searchParams.get("q")
    if (!q || q.trim().length === 0) {
      return NextResponse.json({ tasks: [], projects: [], comments: [], docs: [], members: [] })
    }

    const query = q.trim()

    const [tasks, projects, comments, docs, members] = await Promise.all([
      prisma.task.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          taskList: { select: { projectId: true, project: { select: { name: true } } } },
        },
        take: 10,
      }),
      prisma.project.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, color: true, icon: true, status: true },
        take: 10,
      }),
      prisma.comment.findMany({
        where: { content: { contains: query, mode: "insensitive" } },
        select: {
          id: true,
          content: true,
          taskId: true,
          task: { select: { title: true } },
          user: { select: { id: true, name: true } },
        },
        take: 10,
      }),
      prisma.doc.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { name: true } },
        },
        take: 10,
      }),
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, email: true, avatar: true },
        take: 5,
      }),
    ])

    return NextResponse.json({ tasks, projects, comments, docs, members })
  } catch (error) {
    console.error("Error searching:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
