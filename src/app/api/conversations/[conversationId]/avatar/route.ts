export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { mkdir, unlink, writeFile } from "fs/promises"
import path from "path"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { conversationAccess } from "@/lib/chat-access"
import { chatRaceResponse } from "@/lib/chat-order"
import { resolveUploadedImageType } from "@/lib/image-sniff"
import { emitConversationUpdated } from "@/lib/socket-emitter"

/**
 * Group photo (owner, 22 Oct 2026: "Group info has no way to change the group's picture").
 *
 *   POST   /api/conversations/:id/avatar   multipart `file` (PNG / JPG / WEBP, ≤ 5 MB, judged by its bytes too)
 *          → 200 { conversation: { id, avatarUrl }, url }
 *   DELETE /api/conversations/:id/avatar   → 200 { conversation: { id, avatarUrl: null } }   (no photo: still 200)
 *
 *   400 { code: NO_FILE | BAD_TYPE | TOO_LARGE | NOT_A_GROUP }, 403 not a member, 404 no such room.
 *
 * Who: the rule for renaming the group — any member of a GROUP (canEdit / canEditAvatar on GET …/info). DMs show
 * the other person, project rooms their project: neither has a photo of its own.
 *
 * Stored like user avatars, under uploads/avatars, served by /api/files (session required, `?w=` thumbnails).
 * Every upload gets its own file name (group-<id>-<time>.<ext>): two uploads at once never write the same
 * file, and the row — changed under a row lock — decides which one won; the loser's file and the replaced
 * one are removed after the commit. Members get `conversation-updated` (reason "membership", which every
 * released client already answers by refetching the list and the info screen, plus change "avatar" and the
 * new avatarUrl). Audit: conversation_avatar update / delete.
 */

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
const MAX_SIZE = 5 * 1024 * 1024
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" }
const URL_PREFIX = "/api/files/avatars/"
const avatarDir = () => path.join(process.cwd(), "public", "uploads", "avatars")

/** The file behind one of OUR group-photo URLs, or null (never a path outside uploads/avatars). */
function fileOf(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(URL_PREFIX)) return null
  const name = url.slice(URL_PREFIX.length).split("?")[0]
  if (!/^group-[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(name)) return null
  return path.join(avatarDir(), name)
}

async function removeFile(url: string | null | undefined) {
  const f = fileOf(url)
  if (f) await unlink(f).catch(() => {})
}

type Gate =
  | { ok: true; convo: { id: string; type: string; name: string | null } }
  | { ok: false; res: NextResponse }

async function gate(userId: string, conversationId: string): Promise<Gate> {
  const access = await conversationAccess(userId, conversationId)
  if (!access.ok) {
    return { ok: false, res: NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status }) }
  }
  if (access.convo.type !== "GROUP") {
    return { ok: false, res: NextResponse.json({ error: "Only group chats have a photo", code: "NOT_A_GROUP" }, { status: 400 }) }
  }
  // Same as renaming: a member of the group.
  if (!access.member) return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { ok: true, convo: access.convo }
}

/** Swap the stored URL under a row lock; returns the previous one and the members to tell. */
async function swap(conversationId: string, next: string | null) {
  return prisma.$transaction(async (tx) => {
    const held = await tx.$queryRawUnsafe<{ avatarUrl: string | null }[]>(
      `select "avatarUrl" from "Conversation" where id = $1 for update`,
      conversationId,
    )
    if (held.length === 0) throw Object.assign(new Error("conversation gone"), { code: "GONE" })
    const previous = held[0].avatarUrl
    const updated = await tx.conversation.update({
      where: { id: conversationId },
      data: { avatarUrl: next },
      select: { id: true, name: true, avatarUrl: true, updatedAt: true, members: { select: { userId: true } } },
    })
    return { previous, updated }
  })
}

function announce(updated: { id: string; avatarUrl: string | null; updatedAt: Date; members: { userId: string }[] }) {
  emitConversationUpdated(updated.members.map((m) => m.userId), {
    conversationId: updated.id,
    lastMessageAt: updated.updatedAt.toISOString(),
    reason: "membership",
    change: "avatar",
    avatarUrl: updated.avatarUrl,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  let written: string | null = null
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params
    const g = await gate(userId, conversationId)
    if (!g.ok) return g.res

    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file provided", code: "NO_FILE" }, { status: 400 })
    const type = await resolveUploadedImageType(file, ALLOWED_TYPES)
    if (!type) return NextResponse.json({ error: "Invalid file type. Allowed: PNG, JPG, WEBP", code: "BAD_TYPE" }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "File too large. Maximum size is 5MB", code: "TOO_LARGE" }, { status: 400 })

    const stamp = Date.now()
    const name = `group-${conversationId}-${stamp}.${EXT[type] ?? "png"}`
    await mkdir(avatarDir(), { recursive: true })
    await writeFile(path.join(avatarDir(), name), Buffer.from(await file.arrayBuffer()))
    const url = `${URL_PREFIX}${name}?t=${stamp}`
    written = url

    const { previous, updated } = await swap(conversationId, url)
    written = null
    if (previous && previous !== url) await removeFile(previous)
    announce(updated)
    void logAudit({
      action: "update", entityType: "conversation_avatar", entityId: conversationId,
      entityName: updated.name ?? g.convo.name ?? undefined, userId, request: req,
      metadata: { previous: previous ?? null, next: url },
    })
    return NextResponse.json({ conversation: { id: updated.id, avatarUrl: updated.avatarUrl }, url })
  } catch (error) {
    if (written) await removeFile(written)
    if ((error as { code?: unknown })?.code === "GONE") return NextResponse.json({ error: "Not found" }, { status: 404 })
    const race = chatRaceResponse(error)
    if (race) return NextResponse.json(race.body, { status: race.status })
    console.error("group avatar POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params
    const g = await gate(userId, conversationId)
    if (!g.ok) return g.res

    const { previous, updated } = await swap(conversationId, null)
    if (previous) {
      await removeFile(previous)
      announce(updated)
      void logAudit({
        action: "delete", entityType: "conversation_avatar", entityId: conversationId,
        entityName: updated.name ?? g.convo.name ?? undefined, userId, request: req,
        metadata: { previous, next: null },
      })
    }
    return NextResponse.json({ conversation: { id: updated.id, avatarUrl: null } })
  } catch (error) {
    if ((error as { code?: unknown })?.code === "GONE") return NextResponse.json({ error: "Not found" }, { status: 404 })
    const race = chatRaceResponse(error)
    if (race) return NextResponse.json(race.body, { status: race.status })
    console.error("group avatar DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
