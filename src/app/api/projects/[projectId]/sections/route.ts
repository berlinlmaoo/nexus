import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"

export async function GET(
  _request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed } = await checkProjectAccess(session.user.id!, params.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const sections = await prisma.taskList.findMany({
      where: { projectId: params.projectId },
      orderBy: { position: "asc" },
      include: {
        _count: { select: { tasks: true } },
      },
    })

    return NextResponse.json(sections)
  } catch (error) {
    console.error("Error fetching sections:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed } = await checkProjectAccess(session.user.id!, params.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    const body = await request.json()
    const { name } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    // Auto-set position to last
    const lastSection = await prisma.taskList.findFirst({
      where: { projectId: params.projectId },
      orderBy: { position: "desc" },
      select: { position: true },
    })

    const section = await prisma.taskList.create({
      data: {
        name: name.trim(),
        projectId: params.projectId,
        position: (lastSection?.position ?? -1) + 1,
      },
    })

    return NextResponse.json(section, { status: 201 })
  } catch (error) {
    console.error("Error creating section:", error)
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

    const { allowed } = await checkProjectAccess(session.user.id!, params.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    const body = await request.json()
    const { id, name, position } = body

    if (!id) {
      return NextResponse.json({ error: "Section id is required" }, { status: 400 })
    }

    const existing = await prisma.taskList.findUnique({ where: { id } })
    if (!existing || existing.projectId !== params.projectId) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 })
    }

    // Handle reorder: shift other sections
    if (position !== undefined && position !== existing.position) {
      const oldPos = existing.position
      const newPos = position

      if (newPos < oldPos) {
        // Moving up: shift items in [newPos, oldPos) down by 1
        await prisma.taskList.updateMany({
          where: {
            projectId: params.projectId,
            position: { gte: newPos, lt: oldPos },
          },
          data: { position: { increment: 1 } },
        })
      } else {
        // Moving down: shift items in (oldPos, newPos] up by 1
        await prisma.taskList.updateMany({
          where: {
            projectId: params.projectId,
            position: { gt: oldPos, lte: newPos },
          },
          data: { position: { decrement: 1 } },
        })
      }
    }

    const section = await prisma.taskList.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(position !== undefined && { position }),
      },
    })

    return NextResponse.json(section)
  } catch (error) {
    console.error("Error updating section:", error)
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

    const { allowed } = await checkProjectAccess(session.user.id!, params.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: "Section id is required" }, { status: 400 })
    }

    const allSections = await prisma.taskList.findMany({
      where: { projectId: params.projectId },
      orderBy: { position: "asc" },
    })

    if (allSections.length <= 1) {
      return NextResponse.json({ error: "Cannot delete the last section" }, { status: 400 })
    }

    const target = allSections.find((s) => s.id === id)
    if (!target) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 })
    }

    // Move tasks to first remaining section
    const firstRemaining = allSections.find((s) => s.id !== id)!
    await prisma.task.updateMany({
      where: { taskListId: id },
      data: { taskListId: firstRemaining.id },
    })

    await prisma.taskList.delete({ where: { id } })

    // Re-normalize positions
    const remaining = allSections.filter((s) => s.id !== id)
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position !== i) {
        await prisma.taskList.update({
          where: { id: remaining[i].id },
          data: { position: i },
        })
      }
    }

    return NextResponse.json({ message: "Section deleted", movedTo: firstRemaining.id })
  } catch (error) {
    console.error("Error deleting section:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
