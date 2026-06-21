export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { resolveMime } from "@/lib/mime"
import { checkProjectAccess } from "@/lib/rbac"

const MAX_SIZE = 1024 * 1024 * 1024 // 1GB (cap consistency; large files use the chunk route)

/** A task's project id + a membership/role check — attachments are workspace/project-scoped. */
async function authorizeTask(userId: string, taskId: string, roles: ("VIEWER" | "MEMBER" | "LEAD")[]) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { taskList: { select: { projectId: true } } } })
  const projectId = task?.taskList?.projectId
  if (!projectId) return { ok: false as const, status: 404 as const, error: "Task not found" }
  const { allowed } = await checkProjectAccess(userId, projectId, roles)
  if (!allowed) return { ok: false as const, status: 403 as const, error: "Forbidden" }
  return { ok: true as const, projectId }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const taskId = request.nextUrl.searchParams.get("taskId")
    if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 })

    const authz = await authorizeTask(session.user.id, taskId, ["VIEWER"])
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

    const attachments = await prisma.attachment.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    })

    // Expose `name` (frontend reads att.name) mapped from the stored `filename`.
    return NextResponse.json(attachments.map((a) => ({ ...a, name: a.filename })))
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
      return NextResponse.json({ error: "File too large. Maximum size is 1GB" }, { status: 400 })
    }

    // Must be a member (contributor) of the task's project to attach files to it.
    const authz = await authorizeTask(session.user.id, taskId, ["MEMBER"])
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

    const uploadDir = path.join(process.cwd(), "public", "uploads", "attachments")
    await mkdir(uploadDir, { recursive: true })

    const ext = path.extname(file.name) || ""
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(path.join(uploadDir, safeName), buffer)

    const url = `/api/files/attachments/${safeName}`

    const attachment = await prisma.attachment.create({
      data: {
        filename: file.name,
        url,
        mimeType: resolveMime(file.type, file.name),
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
