export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess } from "@/lib/pnl"
import { unlink } from "fs/promises"
import path from "path"

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
      select: { id: true, url: true, filename: true, expense: { select: { projectId: true } } },
    })
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })

    const gate = await checkPnlAccess(session.user.id, attachment.expense.projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    try {
      const rel = attachment.url.replace(/^\/+/, "").replace(/^api\/files\//, "")
      await unlink(path.join(process.cwd(), "public", "uploads", rel))
    } catch {
      // file may already be gone
    }
    await prisma.pnlExpenseAttachment.delete({ where: { id: attachmentId } })

    logAudit({ action: "delete", entityType: "pnl_expense_attachment", entityId: attachmentId, entityName: attachment.filename, userId: session.user.id, request })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting P&L attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
