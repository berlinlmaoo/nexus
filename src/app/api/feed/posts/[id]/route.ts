export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { notifyFeedMention } from "@/lib/notification-service"
import {
  POST_TEXT_MAX, MENTION_MAX, EDIT_WINDOW_MS, POST_INCLUDE, type PostRow,
  serializePost, getUserOrgRole, isManagerRole, isBodPlus,
} from "@/lib/feed"

// DELETE /api/feed/posts/[id] — soft delete. Author OR workspace manager (BoD/Manager moderation).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const { id } = await params

    const role = await getUserOrgRole(me)
    if (!isBodPlus(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const post = await prisma.post.findFirst({ where: { id, deletedAt: null }, select: { authorId: true } })
    if (!post) return NextResponse.json({ error: "Post tidak ditemukan." }, { status: 404 })

    if (post.authorId !== me && !isManagerRole(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    await prisma.post.update({ where: { id }, data: { deletedAt: new Date() } })
    logAudit({ action: "delete", entityType: "post", entityId: id, userId: me, request, metadata: { moderation: post.authorId !== me } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting post:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/feed/posts/[id] — edit text + mentions. Author-only, within the 15-minute window. Images immutable.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const { id } = await params

    const role = await getUserOrgRole(me)
    if (!isBodPlus(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const text = String(body?.text ?? "").trim()
    const mentionIds: string[] = Array.isArray(body?.mentions) ? body.mentions : []

    const existing = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true, createdAt: true, deletedAt: true, _count: { select: { images: true } }, mentions: { select: { userId: true } } },
    })
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Post tidak ditemukan." }, { status: existing ? 410 : 404 })
    if (existing.authorId !== me) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) return NextResponse.json({ error: "Lewat batas 15 menit buat ngedit." }, { status: 422 })
    if (text.length > POST_TEXT_MAX) return NextResponse.json({ error: `Post terlalu panjang (maks ${POST_TEXT_MAX} karakter).` }, { status: 422 })
    if (!text && existing._count.images === 0) return NextResponse.json({ error: "Post gak boleh kosong." }, { status: 422 })

    const wanted = [...new Set(mentionIds)].filter((x) => typeof x === "string" && x && x !== me).slice(0, MENTION_MAX)
    const validMentions = wanted.length ? await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } }) : []
    const validIds = new Set(validMentions.map((u) => u.id))
    const prevIds = new Set(existing.mentions.map((m) => m.userId))
    const added = validMentions.filter((u) => !prevIds.has(u.id))
    const removedIds = [...prevIds].filter((x) => !validIds.has(x))

    const updated = await prisma.$transaction(async (tx) => {
      if (removedIds.length) await tx.postMention.deleteMany({ where: { postId: id, userId: { in: removedIds } } })
      if (added.length) await tx.postMention.createMany({ data: added.map((u) => ({ postId: id, userId: u.id })), skipDuplicates: true })
      return tx.post.update({ where: { id }, data: { text, editedAt: new Date() }, include: POST_INCLUDE })
    })

    logAudit({ action: "update", entityType: "post", entityId: id, userId: me, request, metadata: { edited: true } })

    // Notify only the NEWLY added mentions.
    const myName = session.user.name || "Seseorang"
    void Promise.all(added.map((u) => notifyFeedMention({ mentionedUserId: u.id, mentionedByName: myName, postId: id, snippet: text }).catch(() => {})))

    return NextResponse.json(serializePost(updated as unknown as PostRow, me, new Set(), isManagerRole(role)))
  } catch (error) {
    console.error("Error editing post:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
