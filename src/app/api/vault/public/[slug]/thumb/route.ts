export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { serveFile } from "@/lib/file-response"
import { vaultThumbnail } from "@/lib/vault-thumb"
import { openShare, itemInShare } from "@/lib/vault-share"

// GET /api/vault/public/<slug>/thumb[?item=<id>]&w=320 — a picture's thumbnail through a link
// (9 Oct 2026): the grid of a shared folder, and the preview card a chat app draws for an external
// link (api/vault/og). A thumbnail is a preview, so a view-only link has them too.
//
// Same gate as the link's bytes: openShare, then itemInShare for a file inside a shared folder.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const access = await openShare(slug)
    if (!access.ok) {
      return NextResponse.json({ error: access.error, reason: access.reason }, { status: access.status })
    }
    const item = await itemInShare(access, request.nextUrl.searchParams.get("item"))
    if (!item || item.kind !== "FILE") return NextResponse.json({ error: "Not found", reason: "missing" }, { status: 404 })

    const thumb = await vaultThumbnail(item, request.nextUrl.searchParams.get("w"))
    if (!thumb.ok) return NextResponse.json({ error: thumb.error }, { status: thumb.status })
    return serveFile(request, thumb.path, {
      filename: thumb.filename,
      contentType: "image/webp",
      // The address carries the content version, but it is still a link that can be revoked: short,
      // and never in a shared cache for an internal link.
      cacheControl: access.share.requireAuth ? "private, max-age=300" : "public, max-age=300",
    })
  } catch (error) {
    console.error("[vault] public thumb failed:", error)
    return NextResponse.json({ error: "Failed to make a thumbnail" }, { status: 500 })
  }
}
