export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { getVaultActor, canReadItem } from "@/lib/vault"
import { vaultThumbnail } from "@/lib/vault-thumb"

// GET /api/vault/items/<id>/thumb?w=320[&v=<version>]
//
// A small WebP of a vault picture (owner, 9 Oct 2026: a folder of photos showed as rows of icons),
// so a grid of thumbnails costs a few KB each instead of every original coming down whole. Same
// access rule as /raw: a vault member who may read the item. The client takes the address from
// the item's `thumbUrl`; `w` is rounded up to one of VAULT_THUMB_WIDTHS.
//
// Made on the first request and kept on disk (lib/vault-thumb.ts, shared with share links' thumbnails).
//
// Caching: `private, max-age=1y, immutable` (serveFile's default for an image). The address carries
// `v=<content version>`, so a replaced file is a new address. nginx passes /api/vault/ through unbuffered.
export async function GET(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { itemId } = await params
    const item = await prisma.vaultItem.findFirst({
      where: { id: itemId, workspaceId: actor.workspaceId, kind: "FILE", deletedAt: null },
      select: { id: true, name: true, mimeType: true, storageKey: true },
    })
    if (!item?.storageKey) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canReadItem(actor, item.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const thumb = await vaultThumbnail(item, request.nextUrl.searchParams.get("w"))
    if (!thumb.ok) return NextResponse.json({ error: thumb.error }, { status: thumb.status })
    return serveFile(request, thumb.path, { filename: thumb.filename, contentType: "image/webp" })
  } catch (error) {
    console.error("[vault] thumb failed:", error)
    return NextResponse.json({ error: "Failed to make a thumbnail" }, { status: 500 })
  }
}
