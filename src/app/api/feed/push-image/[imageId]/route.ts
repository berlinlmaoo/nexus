export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { join, resolve, sep } from "path"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { verifyPushImage } from "@/lib/feed-push-image"

// GET /api/feed/push-image/<PostImage.id>?exp&sig — the photo of a Threads post for the push
// notification's long-press preview (owner, 9 Oct 2026). No session: the iOS Notification Service
// Extension that downloads it has none. The signature is the whole authorization (feed-push-image.ts),
// and it only ever reaches a PostImage of a post that is still up.
export async function GET(req: NextRequest, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params
  const sp = req.nextUrl.searchParams
  if (!verifyPushImage(imageId, sp.get("exp"), sp.get("sig"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const image = await prisma.postImage.findFirst({
    where: { id: imageId, post: { deletedAt: null } },
    select: { url: true, mimeType: true },
  })
  // Stored as /api/files/feed/<name> by POST /api/feed/posts. Anything else is not ours to serve.
  const name = image?.url.startsWith("/api/files/feed/") ? image.url.slice("/api/files/feed/".length) : null
  if (!image || !name) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const base = join(process.cwd(), "public", "uploads", "feed")
  const filePath = resolve(base, name)
  if (!filePath.startsWith(base + sep)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // `private`: the URL is a bearer link, a shared cache must not keep a copy past a post's deletion.
  return serveFile(req, filePath, { mimeType: image.mimeType, cacheControl: "private, max-age=86400" })
}
