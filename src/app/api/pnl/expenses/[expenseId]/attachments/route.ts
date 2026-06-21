export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlExpenseAccess } from "@/lib/pnl"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { resolveMime } from "@/lib/mime"

// Receipts are photos/PDFs — 50MB is generous; huge files belong in task attachments.
const MAX_SIZE = 50 * 1024 * 1024

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { expenseId } = await params
    const gate = await checkPnlExpenseAccess(session.user.id, expenseId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "File too large. Maximum size is 50MB" }, { status: 400 })

    // Same mounted dir as task attachments (persists across container rebuilds), unique names.
    const uploadDir = path.join(process.cwd(), "public", "uploads", "attachments")
    await mkdir(uploadDir, { recursive: true })
    const ext = path.extname(file.name) || ""
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(uploadDir, safeName), buffer)

    const attachment = await prisma.pnlExpenseAttachment.create({
      data: {
        expenseId,
        filename: file.name,
        url: `/api/files/attachments/${safeName}`,
        mimeType: resolveMime(file.type, file.name),
        size: file.size,
        uploaderId: session.user.id,
      },
    })

    logAudit({ action: "create", entityType: "pnl_expense_attachment", entityId: attachment.id, entityName: file.name, userId: session.user.id, request, metadata: { expenseId, size: file.size } })

    return NextResponse.json(attachment, { status: 201 })
  } catch (error) {
    console.error("Error uploading P&L attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
