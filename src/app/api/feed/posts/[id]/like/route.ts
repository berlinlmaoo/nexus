export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"

// POST /api/feed/posts/[id]/like — body-less idempotent toggle. Returns { liked, likeCount }.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    if (!isBodPlus(await getUserOrgRole(me))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params

    const post = await prisma.post.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
    if (!post) return NextResponse.json({ error: "Post tidak ditemukan." }, { status: 404 })

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.postLike.findUnique({ where: { postId_userId: { postId: id, userId: me } }, select: { id: true } })
      let liked: boolean
      if (existing) {
        await tx.postLike.delete({ where: { postId_userId: { postId: id, userId: me } } })
        liked = false
      } else {
        try {
          await tx.postLike.create({ data: { postId: id, userId: me } })
          liked = true
        } catch (e) {
          // Concurrent double-tap hit the unique constraint → already liked.
          if ((e as { code?: string }).code === "P2002") liked = true
          else throw e
        }
      }
      // Recompute from the source-of-truth rows so the denormalized counter can't drift under races.
      const likeCount = await tx.postLike.count({ where: { postId: id } })
      await tx.post.update({ where: { id }, data: { likeCount } })
      return { liked, likeCount }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Error toggling like:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
