export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { isSystemAdminUser } from "@/lib/rbac"
import { validateFolderPlacement } from "@/lib/folder-tree"

async function canManageWorkspace(userId: string, workspaceId: string) {
  if (await isSystemAdminUser(userId)) return true

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  })

  return membership?.role === "BOD" || membership?.role === "MANAGER" || membership?.role === "ONE_ABOVE_ALL"
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.projectFolder.findUnique({
      where: { id: (await params).folderId },
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
    // Icon is an emoji (short) OR an uploaded photo URL ("/api/files/project-icons/folder-…?v=…",
    // 60+ chars) — the old 20-char slice corrupted the URL whenever a folder was renamed later.
    const icon = typeof body.icon === "string"
      ? body.icon.trim().slice(0, body.icon.trim().startsWith("/") ? 300 : 20)
      : undefined
    const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : undefined
    const position = Number.isInteger(body.position) ? body.position : undefined
    // Move into another folder (nesting). Distinguish "not provided" from explicit null (= move to root).
    const hasParentChange = Object.prototype.hasOwnProperty.call(body, "parentFolderId")
    const newParentFolderId = hasParentChange
      ? (typeof body.parentFolderId === "string" && body.parentFolderId.trim() ? body.parentFolderId.trim() : null)
      : undefined

    if (name !== undefined && !name) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 })
    }

    if (hasParentChange) {
      const placementError = await validateFolderPlacement({
        workspaceId: existing.workspaceId,
        parentFolderId: newParentFolderId ?? null,
        movingFolderId: existing.id,
      })
      if (placementError) {
        return NextResponse.json({ error: placementError }, { status: 400 })
      }
    }

    const folder = await prisma.projectFolder.update({
      where: { id: (await params).folderId },
      data: {
        ...(name !== undefined && { name }),
        ...(icon !== undefined && { icon: icon || "📁" }),
        ...(color !== undefined && { color }),
        ...(position !== undefined && { position }),
        ...(hasParentChange && { parentFolderId: newParentFolderId ?? null }),
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
  { params }: { params: Promise<{ folderId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.projectFolder.findUnique({
      where: { id: (await params).folderId },
      select: { id: true, workspaceId: true, parentFolderId: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 })
    }

    if (!(await canManageWorkspace(session.user.id, existing.workspaceId))) {
      return NextResponse.json({ error: "Forbidden: workspace admin required" }, { status: 403 })
    }

    // Deleting a folder must NOT delete what's inside it. Move its subfolders and its projects UP one
    // level (to the deleted folder's own parent — root if it had none), then remove the empty folder.
    await prisma.$transaction([
      prisma.projectFolder.updateMany({
        where: { parentFolderId: existing.id },
        data: { parentFolderId: existing.parentFolderId },
      }),
      prisma.project.updateMany({
        where: { folderId: existing.id },
        data: { folderId: existing.parentFolderId },
      }),
      prisma.projectFolder.delete({ where: { id: existing.id } }),
    ])

    return NextResponse.json({ message: "Folder deleted" })
  } catch (error) {
    console.error("Error deleting project folder:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
