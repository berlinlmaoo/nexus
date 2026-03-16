import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { writeFile, mkdir } from "fs/promises"
import path from "path"

const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/webp",
]

const MAX_SIZE = 5 * 1024 * 1024 // 2MB

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const projectId = formData.get("projectId") as string | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!projectId) {
      return NextResponse.json({ error: "No projectId provided" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PNG, JPG, SVG, WEBP" },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB" },
        { status: 400 }
      )
    }

    const ext = EXT_MAP[file.type] || "png"
    const fileName = `${projectId}.${ext}`

    const uploadDir = path.join(process.cwd(), "public", "uploads", "project-icons")
    await mkdir(uploadDir, { recursive: true })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const filePath = path.join(uploadDir, fileName)
    await writeFile(filePath, buffer)

    const urlPath = `/api/files/project-icons/${fileName}`

    logAudit({ action: "update", entityType: "project_icon", entityId: projectId, userId: session.user.id!, request })

    return NextResponse.json({ url: urlPath })
  } catch (error) {
    console.error("Error uploading project icon:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
