import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { isSystemAdminUser } from "@/lib/rbac"

async function canManageWorkspace(userId: string, workspaceId: string) {
  if (await isSystemAdminUser(userId)) return true

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  })

  return membership?.role === "OWNER" || membership?.role === "ADMIN"
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { folderId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.projectFolder.findUnique({
      where: { id: params.folderId },
      select: { id: true, workspaceId: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 })
    }

    if (!(await canManageWorkspace(session.user.id, existing.workspaceId))) {
      return NextResponse.json({ error: "Forbidden: workspace admin required" }, { status: 403 })
    }

    const body = await request.json()
    const name = typeof body.name === "string" ? body.name.trim() : undefined
    const icon = typeof body.icon === "string" ? body.icon.trim().slice(0, 20) : undefined
    const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : undefined
    const position = Number.isInteger(body.position) ? body.position : undefined

    if (name !== undefined && !name) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 })
    }

    const folder = await prisma.projectFolder.update({
      where: { id: params.folderId },
      data: {
        ...(name !== undefined && { name }),
        ...(icon !== undefined && { icon: icon || "📁" }),
        ...(color !== undefined && { color }),
        ...(position !== undefined && { position }),
      },
    })

    return NextResponse.json(folder)
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "A folder with this name already exists" }, { status: 409 })
    }

    console.error("Error updating project folder:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { folderId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.projectFolder.findUnique({
      where: { id: params.folderId },
      select: { id: true, workspaceId: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 })
    }

    if (!(await canManageWorkspace(session.user.id, existing.workspaceId))) {
      return NextResponse.json({ error: "Forbidden: workspace admin required" }, { status: 403 })
    }

    await prisma.projectFolder.delete({
      where: { id: params.folderId },
    })

    return NextResponse.json({ message: "Folder deleted" })
  } catch (error) {
    console.error("Error deleting project folder:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
