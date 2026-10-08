export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { openShare, itemInShare, trailInShare, childrenInShare, publicItemOf } from "@/lib/vault-share"

// GET /api/vault/public/<slug>/items[?folderId=<id>] — one folder of a shared folder (9 Oct 2026).
//
// No `folderId` = the shared folder itself. Any other folder must be inside it (lib/vault-share.ts
// itemInShare): out of the trash, readable by the role the link answers to, and below the root — an
// id from anywhere else in the vault is the same 404 as one that does not exist. The breadcrumb
// starts at the shared folder, never above it, so the page never learns what the folder sits in.
//
// Not counted as a view: the link's metadata route counts the opening; browsing inside is the same visit.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const access = await openShare(slug)
    if (!access.ok) {
      return NextResponse.json({ error: access.error, reason: access.reason }, { status: access.status })
    }
    const { share } = access
    if (share.item.kind !== "FOLDER") {
      return NextResponse.json({ error: "This link opens a file, not a folder", code: "NOT_A_FOLDER" }, { status: 400 })
    }

    const folder = await itemInShare(access, request.nextUrl.searchParams.get("folderId"))
    if (!folder || folder.kind !== "FOLDER") {
      return NextResponse.json({ error: "Not found", reason: "missing" }, { status: 404 })
    }

    const [trail, children] = await Promise.all([trailInShare(access, folder), childrenInShare(access, folder)])
    return NextResponse.json({
      folder: { id: folder.id, name: folder.name },
      breadcrumb: trail,
      allowDownload: share.allowDownload,
      items: children.map((c) => publicItemOf(slug, c, share.allowDownload)),
    })
  } catch (error) {
    console.error("[vault] public items failed:", error)
    return NextResponse.json({ error: "Failed to list the folder" }, { status: 500 })
  }
}
