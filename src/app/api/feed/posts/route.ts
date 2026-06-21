export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { resolveMime } from "@/lib/mime"
import { notifyFeedMention } from "@/lib/notification-service"
import {
  POST_TEXT_MAX, IMG_MAX, IMG_SIZE_MAX, MENTION_MAX, RATE_MIN_GAP_MS, RATE_HOURLY_MAX,
  POST_INCLUDE, type PostRow, serializePost, getUserOrgRole, isManagerRole, isBodPlus, encodeCursor, decodeCursor,
} from "@/lib/feed"

// GET /api/feed/posts?cursor&limit=20[&mentions=me] — global firehose, newest first.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id

    // BETA gate — The Wire is BoD-and-above only for now.
    const role = await getUserOrgRole(me)
    if (!isBodPlus(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const sp = request.nextUrl.searchParams
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 20, 1), 50)
    const mentionsMe = sp.get("mentions") === "me"
    const cursor = sp.get("cursor") ? decodeCursor(sp.get("cursor")!) : null

    const where: Record<string, unknown> = { deletedAt: null }
    if (mentionsMe) where.mentions = { some: { userId: me } }
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ]
    }

    const rows = await prisma.post.findMany({
      where,
      include: POST_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    })

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const ids = page.map((p) => p.id)

    const liked = ids.length ? await prisma.postLike.findMany({ where: { userId: me, postId: { in: ids } }, select: { postId: true } }) : []
    const likedSet = new Set(liked.map((l) => l.postId))
    const viewerIsManager = isManagerRole(role)

    const last = page[page.length - 1]
    return NextResponse.json({
      posts: page.map((p) => serializePost(p as unknown as PostRow, me, likedSet, viewerIsManager)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      hasMore,
    })
  } catch (error) {
    console.error("Error fetching feed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/feed/posts — multipart: text + images[] + mentions(JSON ids) + imageMeta(JSON [{w,h}]).
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id

    // BETA gate — only BoD-and-above can post to The Wire.
    if (!isBodPlus(await getUserOrgRole(me))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const form = await request.formData()
    const text = String(form.get("text") ?? "").trim()
    const images = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0)

    let mentionIds: string[] = []
    try { const raw = form.get("mentions"); if (raw) mentionIds = JSON.parse(String(raw)) } catch { mentionIds = [] }
    let imageMeta: { w?: number; h?: number }[] = []
    try { const raw = form.get("imageMeta"); if (raw) imageMeta = JSON.parse(String(raw)) } catch { imageMeta = [] }

    // ── Validation ──
    if (text.length > POST_TEXT_MAX) return NextResponse.json({ error: `Post terlalu panjang (maks ${POST_TEXT_MAX} karakter).` }, { status: 422 })
    if (!text && images.length === 0) return NextResponse.json({ error: "Tulis sesuatu atau lampirkan foto." }, { status: 422 })
    if (images.length > IMG_MAX) return NextResponse.json({ error: `Maksimal ${IMG_MAX} foto per post.` }, { status: 422 })
    for (const img of images) {
      if (img.size > IMG_SIZE_MAX) return NextResponse.json({ error: "Foto terlalu besar (maks 8MB)." }, { status: 422 })
      if (!resolveMime(img.type, img.name).startsWith("image/")) return NextResponse.json({ error: "Hanya file gambar yang boleh." }, { status: 422 })
    }

    // ── Rate-limit (anti-spam on a company-wide feed) ──
    const recent = await prisma.post.findFirst({ where: { authorId: me }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
    if (recent && Date.now() - recent.createdAt.getTime() < RATE_MIN_GAP_MS) {
      return NextResponse.json({ error: "Sabar dikit, jeda 20 detik antar post ya 🙏" }, { status: 429 })
    }
    const hourly = await prisma.post.count({ where: { authorId: me, createdAt: { gte: new Date(Date.now() - 3600_000) } } })
    if (hourly >= RATE_HOURLY_MAX) return NextResponse.json({ error: "Udah banyak banget post jam ini, istirahat dulu." }, { status: 429 })

    // ── Validate mentions (real users, dedup, cap, exclude self) ──
    const wanted = [...new Set(mentionIds)].filter((id) => typeof id === "string" && id && id !== me).slice(0, MENTION_MAX)
    const validMentions = wanted.length
      ? await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } })
      : []

    // ── Persist images to disk ──
    const uploadDir = path.join(process.cwd(), "public", "uploads", "feed")
    if (images.length) await mkdir(uploadDir, { recursive: true })
    const imageData: { url: string; mimeType: string; size: number; width: number | null; height: number | null; position: number }[] = []
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const ext = path.extname(img.name) || ".jpg"
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
      await writeFile(path.join(uploadDir, safeName), Buffer.from(await img.arrayBuffer()))
      const meta = imageMeta[i] || {}
      imageData.push({
        url: `/api/files/feed/${safeName}`,
        mimeType: resolveMime(img.type, img.name),
        size: img.size,
        width: typeof meta.w === "number" ? Math.round(meta.w) : null,
        height: typeof meta.h === "number" ? Math.round(meta.h) : null,
        position: i,
      })
    }

    // ── One transaction: Post + images + mentions ──
    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          text,
          authorId: me,
          images: imageData.length ? { create: imageData } : undefined,
          mentions: validMentions.length ? { create: validMentions.map((u) => ({ userId: u.id })) } : undefined,
        },
        include: POST_INCLUDE,
      })
      return created
    })

    logAudit({ action: "create", entityType: "post", entityId: post.id, entityName: text.slice(0, 80), userId: me, request, metadata: { images: imageData.length, mentions: validMentions.length } })

    // After-commit notifications (don't block the response on delivery).
    const myName = session.user.name || "Seseorang"
    void Promise.all(validMentions.map((u) =>
      notifyFeedMention({ mentionedUserId: u.id, mentionedByName: myName, postId: post.id, snippet: text }).catch(() => {})
    ))

    return NextResponse.json(serializePost(post as unknown as PostRow, me, new Set(), false), { status: 201 })
  } catch (error) {
    console.error("Error creating post:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
