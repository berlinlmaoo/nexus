export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveShare, countShareView } from "@/lib/vault-share"

// GET /api/vault/public/<slug> — what the preview page needs before it shows anything.
//
// Anonymous by design when the link says so. The response carries a name, a type and a size — never
// a path, never the workspace, never who uploaded it. A stranger holding the link learns about the
// file, not about the company.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const res = await resolveShare(slug)
    if (!res.ok) {
      return NextResponse.json({ error: res.error, reason: res.reason }, { status: res.status })
    }
    const { share } = res

    // `requireAuth` is enforced HERE, on the server, on every request. Storing the boolean and
    // checking it in the client would make it a hint, and a hint is not a permission.
    if (share.requireAuth) {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json(
          { error: "Tautan ini cuma untuk internal. Masuk dulu ya.", reason: "auth_required", requireAuth: true },
          { status: 401 },
        )
      }
    }

    await countShareView(share.id)

    return NextResponse.json({
      slug: share.slug,
      requireAuth: share.requireAuth,
      allowDownload: share.allowDownload,
      file: {
        name: share.item.name,
        mimeType: share.item.mimeType,
        size: share.item.size,
        width: share.item.width,
        height: share.item.height,
      },
      // Both point back at the slug, never at the file. The bytes have exactly one public address.
      previewUrl: `/api/vault/public/${share.slug}/raw`,
      downloadUrl: share.allowDownload ? `/api/vault/public/${share.slug}/raw?download=1` : null,
    })
  } catch (error) {
    console.error("[vault] public meta failed:", error)
    return NextResponse.json({ error: "Failed to load link" }, { status: 500 })
  }
}
