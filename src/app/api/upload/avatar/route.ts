import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { writeFile, mkdir, unlink, readdir } from "fs/promises"
import path from "path"
import prisma from "@/lib/prisma"

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
const MAX_SIZE = 5 * 1024 * 1024 // 2MB

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PNG, JPG, WEBP" },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB" },
        { status: 400 }
      )
    }

    const userId = session.user.id
    const ext = EXT_MAP[file.type] || "png"
    const fileName = `${userId}.${ext}`

    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars")
    await mkdir(uploadDir, { recursive: true })

    // Remove any existing avatar files for this user
    try {
      const files = await readdir(uploadDir)
      for (const f of files) {
        if (f.startsWith(`${userId}.`)) {
          await unlink(path.join(uploadDir, f))
        }
      }
    } catch {}

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const filePath = path.join(uploadDir, fileName)
    await writeFile(filePath, buffer)

    const avatarUrl = `/api/files/avatars/${fileName}?t=${Date.now()}`

    // Update user in database
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarUrl },
      select: { id: true, name: true, email: true, avatar: true },
    })

    return NextResponse.json({ user, url: avatarUrl })
  } catch (error) {
    console.error("Error uploading avatar:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars")

    // Remove existing avatar files
    try {
      const files = await readdir(uploadDir)
      for (const f of files) {
        if (f.startsWith(`${userId}.`)) {
          await unlink(path.join(uploadDir, f))
        }
      }
    } catch {}

    // Clear avatar in database
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar: null },
      select: { id: true, name: true, email: true, avatar: true },
    })

    return NextResponse.json({ user })
  } catch (error) {
    console.error("Error removing avatar:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
