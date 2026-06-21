export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { isSystemAdminUser } from "@/lib/rbac"
import prisma from "@/lib/prisma"
import { mkdir, writeFile } from "fs/promises"
import path from "path"

const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/webp",
]

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
}

const MAX_SIZE = 5 * 1024 * 1024

async function canManageFolder(userId: string, folderId: string) {
  const folder = await prisma.projectFolder.findUnique({
    where: { id: folderId },
    select: { workspaceId: true },
  })

  if (!folder) return { allowed: false, reason: "Folder not found" as const }
  if (await isSystemAdminUser(userId)) return { allowed: true, reason: "system-admin" as const }

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: folder.workspaceId } },
    select: { role: true },
  })

  return {
    allowed: membership?.role === "BOD" || membership?.role === "MANAGER" || membership?.role === "ONE_ABOVE_ALL",
    reason: "workspace-role" as const,
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const folderId = formData.get("folderId") as string | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!folderId) {
      return NextResponse.json({ error: "No folderId provided" }, { status: 400 })
    }

    const { allowed, reason } = await canManageFolder(session.user.id, folderId)
    if (!allowed) {
      return NextResponse.json({ error: reason === "Folder not found" ? reason : "Forbidden" }, { status: reason === "Folder not found" ? 404 : 403 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: PNG, JPG, SVG, WEBP" }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 5MB" }, { status: 400 })
    }

    const ext = EXT_MAP[file.type] || "png"
    // Stored in the project-icons dir (bind-mounted in prod compose) with a "folder-" prefix —
    // the old dedicated folder-icons dir was NOT mounted, so uploads vanished on every rebuild.
    const fileName = `folder-${folderId}.${ext}`
    const uploadDir = path.join(process.cwd(), "public", "uploads", "project-icons")
    await mkdir(uploadDir, { recursive: true })

    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(uploadDir, fileName), buffer)

    const url = `/api/files/project-icons/${fileName}?v=${Date.now()}`
    await prisma.projectFolder.update({
      where: { id: folderId },
      data: { icon: url },
    })

    logAudit({ action: "update", entityType: "project_folder_icon", entityId: folderId, userId: session.user.id, request })

    return NextResponse.json({ url })
  } catch (error) {
    console.error("Error uploading folder icon:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
