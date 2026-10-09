export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { orgRoleOf } from "@/lib/org"
import prisma from "@/lib/prisma"
import { notifyFeedLike } from "@/lib/notification-service"

// POST /api/feed/posts/[id]/like — body-less idempotent toggle. Returns { liked, likeCount }.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // The Wire is the company feed: members of the company workspace only.
    if (!(await orgRoleOf(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const me = session.user.id
    const { id } = await params

    const post = await prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, authorId: true, text: true, _count: { select: { images: true } } },
    })
    if (!post) return NextResponse.json({ error: "Post tidak ditemukan." }, { status: 404 })

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.postLike.findUnique({ where: { postId_userId: { postId: id, userId: me } }, select: { id: true } })
      let liked: boolean
      // Only a like THIS request created tells the author; a double-tap's losing twin does not.
      let created = false
      if (existing) {
        await tx.postLike.delete({ where: { postId_userId: { postId: id, userId: me } } })
        liked = false
      } else {
        try {
          await tx.postLike.create({ data: { postId: id, userId: me } })
          liked = true
          created = true
        } catch (e) {
          // Concurrent double-tap hit the unique constraint → already liked.
          if ((e as { code?: string }).code === "P2002") liked = true
          else throw e
        }
      }
      // Recompute from the source-of-truth rows so the denormalized counter can't drift under races.
      const likeCount = await tx.postLike.count({ where: { postId: id } })
      await tx.post.update({ where: { id }, data: { likeCount } })
      return { liked, likeCount, created }
    })

    // Like X: the author hears "{name} liked your post" — once per person per post, never for their
    // own like, never for an unlike (owner, 9 Oct 2026). After the commit, not awaited.
    if (result.created && post.authorId !== me) {
      void notifyFeedLike({
        postId: id, authorId: post.authorId, likerId: me, likerName: session.user.name || "Seseorang",
        postText: post.text, hasPhoto: post._count.images > 0,
      }).catch((error) => console.error("Error notifying like:", error))
    }

    return NextResponse.json({ liked: result.liked, likeCount: result.likeCount })
  } catch (error) {
    console.error("Error toggling like:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
