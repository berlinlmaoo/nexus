import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function GET(
  _request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        taskLists: {
          include: {
            tasks: {
              include: {
                assignees: { include: { user: true } },
              },
              orderBy: { position: "asc" },
            },
          },
          orderBy: { position: "asc" },
        },
        members: {
          include: { user: true },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    return NextResponse.json(project)
  } catch (error) {
    console.error("Error fetching project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { name, description, color, icon, status } = body

    const existing = await prisma.project.findUnique({
      where: { id: params.projectId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const project = await prisma.project.update({
      where: { id: params.projectId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(icon !== undefined && { icon }),
        ...(status !== undefined && { status }),
      },
      include: {
        taskLists: true,
        members: { include: { user: true } },
      },
    })

    logAudit({
      action: "update", entityType: "project", entityId: params.projectId, entityName: project.name,
      userId: session.user.id!, request, metadata: { changes: body },
    })

    return NextResponse.json(project)
  } catch (error) {
    console.error("Error updating project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.project.findUnique({
      where: { id: params.projectId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    logAudit({
      action: "delete", entityType: "project", entityId: params.projectId, entityName: existing.name,
      userId: session.user.id!, request,
    })

    await prisma.project.delete({
      where: { id: params.projectId },
    })

    return NextResponse.json({ message: "Project deleted" })
  } catch (error) {
    console.error("Error deleting project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
