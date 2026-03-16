import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
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

    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } })
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })

    // Delete file from disk
    try {
      const filePath = path.join(process.cwd(), "public", attachment.url)
      await unlink(filePath)
    } catch {
      // File may already be gone
    }

    await prisma.attachment.delete({ where: { id: attachmentId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
