import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const workspaceId = request.nextUrl.searchParams.get("workspaceId")

    const where: Record<string, unknown> = {
      members: {
        some: { userId: session.user.id },
      },
    }

    if (workspaceId) {
      where.workspaceId = workspaceId
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        _count: {
          select: {
            members: true,
            taskLists: true,
          },
        },
        taskLists: {
          include: {
            _count: {
              select: { tasks: true },
            },
          },
        },
        members: {
          include: { user: true },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    const result = projects.map((project) => {
      const taskCount = project.taskLists.reduce(
        (sum, tl) => sum + tl._count.tasks,
        0
      )
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { taskLists: _lists, ...rest } = project
      return {
        ...rest,
        _count: {
          ...project._count,
          tasks: taskCount,
        },
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Error fetching projects:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { name, description, color, icon, workspaceId } = body

    if (!name || !workspaceId) {
      return NextResponse.json({ error: "Name and workspaceId are required" }, { status: 400 })
    }

    const userId = session.user.id

    // Verify the user is a member of the target workspace
    const workspaceMembership = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    })
    if (!workspaceMembership) {
      return NextResponse.json({ error: "Forbidden: you are not a member of this workspace" }, { status: 403 })
    }

    const project = await prisma.project.create({
      data: {
        name,
        description,
        color,
        icon,
        workspaceId,
        members: {
          create: {
            userId,
            role: "LEAD",
          },
        },
        taskLists: {
          create: [
            { name: "To Do", position: 0 },
            { name: "In Progress", position: 1 },
            { name: "Done", position: 2 },
          ],
        },
        pages: {
          create: [
            { name: "Tasks", icon: "💻", pageType: "tasks", position: 0 },
            { name: "Calendar", icon: "📅", pageType: "calendar", position: 1 },
            { name: "Documents", icon: "📁", pageType: "documents", position: 2 },
            { name: "To Do List", icon: "⭐", pageType: "todo", position: 3 },
          ],
        },
      },
      include: {
        members: { include: { user: true } },
        taskLists: true,
        pages: true,
      },
    })

    logAudit({ action: "create", entityType: "project", entityId: project.id, entityName: name, userId, request })

    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    console.error("Error creating project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
