export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveUploadedImageType } from "@/lib/image-sniff"
import { canPostInConversation, conversationMemberAccess } from "@/lib/chat-access"
import { logAudit } from "@/lib/audit"
import { checkRateLimitByKey } from "@/lib/rate-limit"
import {
  bytesMatchDoc,
  CHAT_IMAGE_TYPES,
  CHAT_SNIFF_BYTES,
  classifyChatUpload,
  cleanFileName,
} from "@/lib/chat-files"
import { writeFile, mkdir } from "fs/promises"
import { randomUUID } from "crypto"
import path from "path"

/** Enough for a burst of pictures; a script parking files in the uploads folder hits it quickly. */
const UPLOAD_LIMIT = { limit: 30, windowSeconds: 60 }

/**
 * Upload one picture or document for a chat message (documents since 18 Oct 2026, chat-files.ts).
 *
 * Membership is checked before a byte is written: without it, anyone signed in could park files in
 * the uploads directory by guessing conversation ids.
 *
 * Filenames are random rather than derived from the user or the message. Avatars can be
 * `<userId>.jpg` because there is exactly one per person and overwriting is the point; here two
 * people uploading in the same second must not collide, and a guessable name would let someone
 * fish for other conversations' pictures. A document's real name travels with the message
 * (attachmentName) and is put back on the download.
 *
 * → { url, type, kind: "image" | "file", name, size }. Refusals carry a `code`:
 *   UNSUPPORTED_TYPE (400) not one of the formats, or the bytes are not what the extension says
 *   TOO_LARGE (413)        over 8 MB for a picture, 25 MB for a document (`maxBytes` says which)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const rate = checkRateLimitByKey("chat-upload", userId, UPLOAD_LIMIT)
    if (!rate.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))
      return NextResponse.json(
        { error: "Terlalu banyak unggahan dalam satu menit. Tunggu sebentar.", code: "RATE_LIMITED", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const conversationId = String(formData.get("conversationId") ?? "")

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 })

    // A picture exactly as before (a part labelled application/octet-stream is judged by its bytes);
    // anything else must be a document on the list, by extension, and its bytes must agree.
    const imageType = await resolveUploadedImageType(file, CHAT_IMAGE_TYPES)
    const verdict = classifyChatUpload(file.name, imageType)
    if (!verdict.ok) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PNG, JPG, WEBP, GIF, PDF, Word, Excel, PowerPoint, CSV, TXT, ZIP", code: "UNSUPPORTED_TYPE" },
        { status: 400 },
      )
    }
    if (file.size > verdict.maxBytes) {
      const mb = verdict.maxBytes / (1024 * 1024)
      return NextResponse.json(
        { error: `File too large. Maximum size is ${mb}MB`, code: "TOO_LARGE", maxBytes: verdict.maxBytes },
        { status: verdict.kind === "image" ? 400 : 413 },
      )
    }
    if (file.size === 0) return NextResponse.json({ error: "The file is empty", code: "EMPTY_FILE" }, { status: 400 })

    // A member of the room who may still be in it (a project member of a project room, in the
    // group/DM's workspace) and may post there — the same rule as sending the message it belongs to.
    const access = await conversationMemberAccess(userId, conversationId)
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (access.convo && !(await canPostInConversation(userId, access.convo))) {
      return NextResponse.json({ error: "You can view this project but not post in it.", code: "NEEDS_COMMENT_ACCESS" }, { status: 403 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (verdict.kind === "file" && !bytesMatchDoc(verdict.ext, bytes.subarray(0, CHAT_SNIFF_BYTES), bytes)) {
      return NextResponse.json(
        { error: "This file is not the type its name says.", code: "UNSUPPORTED_TYPE" },
        { status: 400 },
      )
    }

    const fileName = `${randomUUID()}.${verdict.ext}`
    const uploadDir = path.join(process.cwd(), "public", "uploads", "chat")
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, fileName), bytes)

    logAudit({ action: "create", entityType: "chat_attachment", entityId: fileName, userId, request })

    return NextResponse.json({
      url: `/api/files/chat/${fileName}`,
      type: verdict.type,
      kind: verdict.kind,
      name: cleanFileName(file.name, verdict.kind === "file" ? verdict.ext : ""),
      size: file.size,
    })
  } catch (error) {
    console.error("chat upload error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

