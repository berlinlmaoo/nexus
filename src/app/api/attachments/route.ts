import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { writeFile, mkdir } from "fs/promises"
import path from "path"

const MAX_SIZE = 10 * 1024 * 1024 // 10MB

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const taskId = request.nextUrl.searchParams.get("taskId")
    if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 })

    const attachments = await prisma.attachment.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(attachments)
  } catch (error) {
    console.error("Error fetching attachments:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const taskId = formData.get("taskId") as string | null

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 })

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 10MB" }, { status: 400 })
    }

    // Verify task exists
    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

    const uploadDir = path.join(process.cwd(), "public", "uploads", "attachments")
    await mkdir(uploadDir, { recursive: true })

    const ext = path.extname(file.name) || ""
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(path.join(uploadDir, safeName), buffer)

    const url = `/uploads/attachments/${safeName}`

    const attachment = await prisma.attachment.create({
      data: {
        filename: file.name,
        url,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        taskId,
        uploaderId: session.user.id,
      },
    })

    logAudit({ action: "create", entityType: "attachment", entityId: attachment.id, entityName: file.name, userId: session.user.id, request, metadata: { taskId, mimeType: file.type, size: file.size } })

    return NextResponse.json(attachment, { status: 201 })
  } catch (error) {
    console.error("Error uploading attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
