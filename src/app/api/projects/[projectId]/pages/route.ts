import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

const DEFAULT_PAGES = [
  { name: "Tasks", icon: "💻", pageType: "tasks", position: 0 },
  { name: "Calendar", icon: "📅", pageType: "calendar", position: 1 },
  { name: "Documents", icon: "📁", pageType: "documents", position: 2 },
  { name: "To Do List", icon: "⭐", pageType: "todo", position: 3 },
]

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { projectId } = params

    // Check if project has any pages, if not create defaults
    const pageCount = await prisma.projectPage.count({ where: { projectId } })
    if (pageCount === 0) {
      // Verify project exists
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
      if (project) {
        await prisma.projectPage.createMany({
          data: DEFAULT_PAGES.map((p) => ({ ...p, projectId })),
        })
      }
    }

    const pages = await prisma.projectPage.findMany({
      where: { projectId, parentId: null },
      include: {
        children: {
          include: {
            children: true,
          },
          orderBy: { position: "asc" },
        },
      },
      orderBy: { position: "asc" },
    })

    return NextResponse.json(pages)
  } catch (error) {
    console.error("Error fetching project pages:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { projectId } = params
    const body = await request.json()
    const { name, icon, pageType, parentId, content } = body

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    // Get next position
    const lastPage = await prisma.projectPage.findFirst({
      where: { projectId, parentId: parentId || null },
      orderBy: { position: "desc" },
      select: { position: true },
    })

    const page = await prisma.projectPage.create({
      data: {
        name,
        icon: icon || "📄",
        pageType: pageType || "custom",
        content: content || null,
        position: (lastPage?.position ?? -1) + 1,
        projectId,
        parentId: parentId || null,
      },
      include: {
        children: true,
      },
    })

    logAudit({ action: "create", entityType: "project_page", entityId: page.id, entityName: name, userId: session.user.id, request, metadata: { projectId } })

    return NextResponse.json(page, { status: 201 })
  } catch (error) {
    console.error("Error creating project page:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
