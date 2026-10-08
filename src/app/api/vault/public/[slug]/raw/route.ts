export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { serveFile, previewKindOf } from "@/lib/file-response"
import { storagePath } from "@/lib/vault"
import { openShare, itemInShare, shareCacheControl } from "@/lib/vault-share"

// GET /api/vault/public/<slug>/raw[?item=<id>][&download=1] — the bytes behind a share link.
//
// The only route in the app that will serve a file to someone with no session, and the whole reason
// the design routes public reads through a share row instead of through /api/files: revocation and
// expiry are re-checked on every single request, and the caller never names a path.
//
// `item` (9 Oct 2026): a file inside a shared FOLDER, by id. It must be inside that folder's subtree,
// out of the trash, and readable by the role the link answers to (lib/vault-share.ts itemInShare);
// anything else is the same 404 as an id that does not exist.
//
// View-only links (allowDownload = false) serve only what a browser can SHOW — a picture, a film, a
// sound, a PDF — and always inline. Anything else (Word, Excel, a zip…) has no preview, so serving
// it at all would be a download by another name: 403 PREVIEW_ONLY.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const access = await openShare(slug)
    if (!access.ok) {
      return NextResponse.json({ error: access.error, reason: access.reason }, { status: access.status })
    }
    const { share } = access

    const requested = request.nextUrl.searchParams.get("item")
    const item = await itemInShare(access, requested)
    if (!item) return NextResponse.json({ error: "Not found", reason: "missing" }, { status: 404 })
    if (item.kind !== "FILE" || !item.storageKey) {
      return NextResponse.json(
        { error: "Tautan ini membuka folder. Perbarui NEXUS untuk menjelajahinya.", code: "IS_FOLDER" },
        { status: 400 },
      )
    }

    const wantsDownload = request.nextUrl.searchParams.has("download")
    if (wantsDownload && !share.allowDownload) {
      return NextResponse.json(
        { error: "Tautan ini cuma untuk dilihat, tidak bisa diunduh", code: "VIEW_ONLY" },
        { status: 403 },
      )
    }
    if (!share.allowDownload && !previewKindOf(item.storageKey, item.mimeType)) {
      return NextResponse.json(
        { error: "Berkas ini tidak bisa dipratinjau, dan pengirimnya mematikan unduhan.", code: "PREVIEW_ONLY" },
        { status: 403 },
      )
    }

    return serveFile(request, storagePath(item.storageKey), {
      filename: item.name,
      mimeType: item.mimeType,
      forceDownload: wantsDownload,
      // A preview-only link must not hand the browser an attachment through any other door either —
      // "Save as" is still possible from a preview, but the link itself never offers the file.
      forceInline: !share.allowDownload,
      // Short either way — this URL's meaning can change the moment somebody revokes it, and a
      // long-lived edge copy is exactly how a revoked link keeps working for another day. `private`
      // for an internal link: that response was made for one session.
      cacheControl: shareCacheControl(share),
    })
  } catch (error) {
    console.error("[vault] public raw failed:", error)
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 })
  }
}
