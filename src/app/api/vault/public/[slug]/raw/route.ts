export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { serveFile } from "@/lib/file-response"
import { storagePath } from "@/lib/vault"
import { resolveShare } from "@/lib/vault-share"

// GET /api/vault/public/<slug>/raw[?download=1] — the bytes behind a share link.
//
// The only route in the app that will serve a file to someone with no session, and the whole reason
// the design routes public reads through a share row instead of through /api/files: revocation and
// expiry are re-checked on every single request, and the caller never names a path.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const res = await resolveShare(slug)
    if (!res.ok) return NextResponse.json({ error: res.error, reason: res.reason }, { status: res.status })
    const { share } = res

    if (share.requireAuth) {
      const session = await auth()
      if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const wantsDownload = request.nextUrl.searchParams.has("download")
    if (wantsDownload && !share.allowDownload) {
      return NextResponse.json({ error: "Tautan ini cuma untuk dilihat, tidak bisa diunduh" }, { status: 403 })
    }

    return serveFile(request, storagePath(share.item.storageKey as string), {
      filename: share.item.name,
      forceDownload: wantsDownload,
      // A preview-only link must not hand the browser an attachment through any other door either —
      // "Save as" is still possible from a preview, but the link itself never offers the file.
      forceInline: !share.allowDownload,
      // NOT `private`: an anonymous link has no session for a shared cache to leak between users.
      // Still short — this URL's meaning can change the moment somebody revokes it, and a
      // long-lived edge copy is exactly how a revoked link keeps working for another day.
      cacheControl: "public, max-age=60",
    })
  } catch (error) {
    console.error("[vault] public raw failed:", error)
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 })
  }
}
