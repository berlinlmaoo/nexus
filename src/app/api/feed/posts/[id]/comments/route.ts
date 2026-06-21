export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { notifyFeedComment } from "@/lib/notification-service"
import { MENTION_MAX, getUserOrgRole, isBodPlus } from "@/lib/feed"

const COMMENT_MAX = 1000

// GET /api/feed/posts/[id]/comments — oldest first.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!isBodPlus(await getUserOrgRole(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params

    const comments = await prisma.postComment.findMany({
      where: { postId: id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    })
    return NextResponse.json({ comments })
  } catch (error) {
    console.error("Error fetching comments:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/feed/posts/[id]/comments — { text, mentions: string[] }.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    if (!isBodPlus(await getUserOrgRole(me))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params

    const body = await request.json().catch(() => ({}))
    const text = String(body?.text ?? "").trim()
    const mentionIds: string[] = Array.isArray(body?.mentions) ? body.mentions : []
    if (!text) return NextResponse.json({ error: "Komentar gak boleh kosong." }, { status: 422 })
    if (text.length > COMMENT_MAX) return NextResponse.json({ error: "Komentar terlalu panjang." }, { status: 422 })

    const post = await prisma.post.findFirst({ where: { id, deletedAt: null }, select: { authorId: true } })
    if (!post) return NextResponse.json({ error: "Post tidak ditemukan." }, { status: 404 })

    const wanted = [...new Set(mentionIds)].filter((x) => typeof x === "string" && x && x !== me).slice(0, MENTION_MAX)
    const validMentions = wanted.length ? await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } }) : []

    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.postComment.create({
        data: { text, postId: id, authorId: me },
        include: { author: { select: { id: true, name: true, avatar: true } } },
      })
      const commentCount = await tx.postComment.count({ where: { postId: id, deletedAt: null } })
      await tx.post.update({ where: { id }, data: { commentCount } })
      return c
    })

    // Notify: post author (if not me) + mentioned (deduped against author).
    const myName = session.user.name || "Seseorang"
    const notified = new Set<string>()
    if (post.authorId !== me) {
      notified.add(post.authorId)
      void notifyFeedComment({ recipientUserId: post.authorId, commenterName: myName, postId: id, snippet: text, reason: "author" }).catch(() => {})
    }
    for (const u of validMentions) {
      if (u.id === me || notified.has(u.id)) continue
      notified.add(u.id)
      void notifyFeedComment({ recipientUserId: u.id, commenterName: myName, postId: id, snippet: text, reason: "mention" }).catch(() => {})
    }

    return NextResponse.json(comment, { status: 201 })
  } catch (error) {
    console.error("Error creating comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
