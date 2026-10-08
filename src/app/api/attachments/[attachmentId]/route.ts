export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { checkProjectAccess } from "@/lib/rbac"

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
      include: { task: { select: { title: true, taskList: { select: { projectId: true, project: { select: { workspaceId: true } } } } } } },
    })
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })

    // Only the uploader or a project member (contributor+) may delete an attachment.
    const projectId = attachment.task?.taskList?.projectId
    if (attachment.uploaderId !== session.user.id) {
      const allowed = projectId ? (await checkProjectAccess(session.user.id, projectId, ["MEMBER"])).allowed : false
      if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // The row (and its proof annotations) is kept first, and the file stays on disk, so Control Room →
    // Audit can restore it. The 90-day purge of copies removes the file once nothing points at it.
    await restorableDelete({
      entityType: "attachment", entityId: attachmentId, entityName: attachment.filename,
      workspaceId: attachment.task?.taskList?.project?.workspaceId ?? null, userId: session.user.id, request,
      metadata: { taskId: attachment.taskId, taskTitle: attachment.task?.title ?? null, projectId: projectId ?? null },
      meta: { open: { type: "task", id: attachment.taskId, ...(projectId ? { projectId } : {}) }, projectId: projectId ?? null, taskId: attachment.taskId },
      remove: (tx) => tx.attachment.delete({ where: { id: attachmentId } }),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
