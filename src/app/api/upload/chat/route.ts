export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { writeFile, mkdir } from "fs/promises"
import { randomUUID } from "crypto"
import path from "path"

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]
const MAX_SIZE = 8 * 1024 * 1024 // 8 MB

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/**
 * Upload one image for a chat message.
 *
 * Membership is checked before a byte is written: without it, anyone signed in could park files in
 * the uploads directory by guessing conversation ids.
 *
 * Filenames are random rather than derived from the user or the message. Avatars can be
 * `<userId>.jpg` because there is exactly one per person and overwriting is the point; here two
 * people uploading in the same second must not collide, and a guessable name would let someone
 * fish for other conversations' pictures.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const conversationId = String(formData.get("conversationId") ?? "")

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: PNG, JPG, WEBP, GIF" }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 8MB" }, { status: 400 })
    }

    const member = await prisma.conversationMember.findFirst({
      where: { conversationId, userId: session.user.id },
      select: { userId: true },
    })
    if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const ext = EXT_MAP[file.type] || "png"
    const fileName = `${randomUUID()}.${ext}`
    const uploadDir = path.join(process.cwd(), "public", "uploads", "chat")
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, fileName), Buffer.from(await file.arrayBuffer()))

    logAudit({ action: "create", entityType: "chat_attachment", entityId: fileName, userId: session.user.id, request })

    return NextResponse.json({ url: `/api/files/chat/${fileName}`, type: file.type })
  } catch (error) {
    console.error("chat upload error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
