export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkPnlAccess } from "@/lib/pnl"
import { restorableDelete } from "@/lib/deletion-snapshot"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { attachmentId } = await params
    const attachment = await prisma.pnlExpenseAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, url: true, filename: true, expenseId: true, expense: { select: { projectId: true, project: { select: { workspaceId: true } } } } },
    })
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })

    const gate = await checkPnlAccess(session.user.id, attachment.expense.projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    // Kept first and the file stays on disk, so Control Room → Audit can restore it. The 90-day purge
    // of copies removes the file once nothing points at it.
    const projectId = attachment.expense.projectId
    await restorableDelete({
      entityType: "pnl_expense_attachment", entityId: attachmentId, entityName: attachment.filename,
      workspaceId: attachment.expense.project.workspaceId, userId: session.user.id, request,
      metadata: { projectId, expenseId: attachment.expenseId },
      meta: { open: { type: "pnl", id: projectId, projectId: projectId }, projectId: projectId },
      remove: (tx) => tx.pnlExpenseAttachment.delete({ where: { id: attachmentId } }),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting P&L attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
