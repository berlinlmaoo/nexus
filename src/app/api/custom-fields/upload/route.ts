export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { resolveMime } from "@/lib/mime"
import { checkProjectAccess } from "@/lib/rbac"

const MAX_SIZE = 250 * 1024 * 1024 // 250MB per file for a "Files & media" custom field

// Upload one file for a FILE custom field. Project-member scoped. Writes under the EXISTING `attachments`
// uploads mount (subdir cf/) so it survives container recreates, and returns a URL served by the
// login-gated /api/files route. The URL + name are then stored in the field value (a JSON array).
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const projectId = formData.get("projectId") as string | null

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "File too large. Maximum size is 250MB" }, { status: 400 })

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const uploadDir = path.join(process.cwd(), "public", "uploads", "attachments", "cf")
    await mkdir(uploadDir, { recursive: true })

    const ext = path.extname(file.name) || ""
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(uploadDir, safeName), buffer)

    const url = `/api/files/attachments/cf/${safeName}`
    return NextResponse.json({ url, name: file.name, size: file.size, type: resolveMime(file.type, file.name) }, { status: 201 })
  } catch (error) {
    console.error("Error uploading custom-field file:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
