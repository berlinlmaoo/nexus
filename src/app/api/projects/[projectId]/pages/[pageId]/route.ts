import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; pageId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const page = await prisma.projectPage.findUnique({
      where: { id: params.pageId },
      include: {
        children: {
          include: { children: true },
          orderBy: { position: "asc" },
        },
        parent: {
          select: { id: true, name: true, icon: true },
        },
        project: {
          select: { id: true, name: true, icon: true, color: true },
        },
      },
    })

    if (!page || page.projectId !== params.projectId) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 })
    }

    return NextResponse.json(page)
  } catch (error) {
    console.error("Error fetching page:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string; pageId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { name, icon, content, position, pageType } = body

    const existing = await prisma.projectPage.findUnique({
      where: { id: params.pageId },
      select: { projectId: true },
    })

    if (!existing || existing.projectId !== params.projectId) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (icon !== undefined) data.icon = icon
    if (content !== undefined) data.content = content
    if (position !== undefined) data.position = position
    if (pageType !== undefined) data.pageType = pageType

    const page = await prisma.projectPage.update({
      where: { id: params.pageId },
      data,
      include: { children: true },
    })

    return NextResponse.json(page)
  } catch (error) {
    console.error("Error updating page:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; pageId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.projectPage.findUnique({
      where: { id: params.pageId },
      select: { projectId: true },
    })

    if (!existing || existing.projectId !== params.projectId) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 })
    }

    await prisma.projectPage.delete({ where: { id: params.pageId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting page:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
