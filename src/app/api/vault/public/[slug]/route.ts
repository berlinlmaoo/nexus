export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { openShare, countShareView, publicItemOf, shareBase } from "@/lib/vault-share"

// GET /api/vault/public/<slug> — what the link's page needs before it shows anything.
//
// Anonymous by design when the link says so. The response carries a name, a type, a size and the
// first name of whoever made the link ("Shared by …", owner 9 Oct 2026) — never a path, never the
// workspace, never who uploaded the file. A stranger holding the link learns about the file, not
// about the company.
//
// Since 9 Oct 2026 a link can open a FOLDER: `kind` says which, `folder` describes it, and its
// contents come from …/items. Every field older apps decode (slug, requireAuth, allowDownload, file,
// previewUrl, downloadUrl) is still sent; for a folder, `file` carries the folder's name.
//
// Internal links answer only to a member of the vault's company whose role clears the folder's lock
// (lib/vault-share.ts openShare), here and on every byte behind them.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const access = await openShare(slug)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error, reason: access.reason, ...(access.reason === "auth_required" ? { requireAuth: true } : {}) },
        { status: access.status },
      )
    }
    const { share } = access

    await countShareView(share.id)

    const root = publicItemOf(slug, share.item, share.allowDownload, true)
    const isFolder = share.item.kind === "FOLDER"
    const base = shareBase(slug)

    return NextResponse.json({
      slug: share.slug,
      kind: isFolder ? "FOLDER" : "FILE",
      requireAuth: share.requireAuth,
      allowDownload: share.allowDownload,
      expiresAt: share.expiresAt?.toISOString() ?? null,
      sharedBy: share.sharedBy,
      file: {
        name: share.item.name,
        mimeType: share.item.mimeType,
        size: share.item.size,
        width: share.item.width,
        height: share.item.height,
      },
      // Both point back at the slug, never at the file. The bytes have exactly one public address.
      // Kept as a string for apps that decode it as one: for a folder it answers 400 IS_FOLDER.
      previewUrl: root.previewUrl ?? `${base}/raw${root.fileVersion ? `?v=${root.fileVersion}` : ""}`,
      downloadUrl: root.downloadUrl,
      previewKind: root.previewKind,
      thumbUrl: root.thumbUrl,
      // The same row a folder listing sends, for clients that want one shape for everything.
      item: root,
      folder: isFolder ? { id: share.item.id, name: share.item.name } : null,
      // Everything below the folder as one .zip — only when the link allows downloads.
      zipUrl: isFolder && share.allowDownload ? `${base}/zip` : null,
    })
  } catch (error) {
    console.error("[vault] public meta failed:", error)
    return NextResponse.json({ error: "Failed to load link" }, { status: 500 })
  }
}
