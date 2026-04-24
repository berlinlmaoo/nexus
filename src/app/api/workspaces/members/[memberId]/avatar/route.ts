import { NextRequest, NextResponse } from "next/server"
import { mkdir, readdir, unlink, writeFile } from "fs/promises"
import path from "path"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import prisma from "@/lib/prisma"

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
const MAX_SIZE = 5 * 1024 * 1024

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
}

async function getWorkspaceAndRole(userId: string, workspaceId?: string) {
  return prisma.workspaceMember.findFirst({
    where: {
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { memberId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const targetMember = await prisma.workspaceMember.findUnique({
      where: { id: params.memberId },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    })

    if (!targetMember) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    const currentMember = await getWorkspaceAndRole(session.user.id, targetMember.workspaceId)
    if (!currentMember) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 })
    }

    if (currentMember.role !== "OWNER" && currentMember.role !== "ADMIN") {
      return NextResponse.json({ error: "Only owners and admins can edit operatives" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: PNG, JPG, WEBP" }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 5MB" }, { status: 400 })
    }

    const userId = targetMember.user.id
    const ext = EXT_MAP[file.type] || "png"
    const fileName = `${userId}.${ext}`
    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars")

    await mkdir(uploadDir, { recursive: true })

    try {
      const files = await readdir(uploadDir)
      for (const fileNameInDir of files) {
        if (fileNameInDir.startsWith(`${userId}.`)) {
          await unlink(path.join(uploadDir, fileNameInDir))
        }
      }
    } catch {}

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    await writeFile(path.join(uploadDir, fileName), buffer)

    const avatarUrl = `/api/files/avatars/${fileName}?t=${Date.now()}`

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarUrl },
      select: { id: true, name: true, email: true, avatar: true },
    })

    await logAudit({
      action: "update",
      entityType: "workspace_member_avatar",
      entityId: params.memberId,
      entityName: user.email,
      userId: session.user.id,
      request,
      metadata: {
        workspaceId: targetMember.workspaceId,
        targetUserId: userId,
      },
    })

    return NextResponse.json({ user, url: avatarUrl })
  } catch (error) {
    console.error("Error uploading workspace member avatar:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
