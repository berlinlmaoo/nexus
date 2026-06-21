export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { unlink } from "fs/promises"
import path from "path"
import { checkProjectAccess } from "@/lib/rbac"

function resolveAttachmentFilePath(url: string) {
  const normalizedUrl = url.replace(/^\/+/, "")

  const uploadRelativePath = normalizedUrl.startsWith("api/files/")
    ? normalizedUrl.slice("api/files/".length)
    : normalizedUrl.startsWith("uploads/")
      ? normalizedUrl.slice("uploads/".length)
      : normalizedUrl

  return path.join(process.cwd(), "public", "uploads", uploadRelativePath)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { attachmentId } = await params

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { task: { select: { taskList: { select: { projectId: true } } } } },
    })
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })

    // Only the uploader or a project member (contributor+) may delete an attachment.
    const projectId = attachment.task?.taskList?.projectId
    if (attachment.uploaderId !== session.user.id) {
      const allowed = projectId ? (await checkProjectAccess(session.user.id, projectId, ["MEMBER"])).allowed : false
      if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Delete file from disk
    try {
      const filePath = resolveAttachmentFilePath(attachment.url)
      await unlink(filePath)
    } catch {
      // File may already be gone
    }

    await prisma.attachment.delete({ where: { id: attachmentId } })

    logAudit({ action: "delete", entityType: "attachment", entityId: attachmentId, entityName: attachment.filename, userId: session.user.id, request })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
