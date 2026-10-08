export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { storagePath } from "@/lib/vault"
import { openShare, itemInShare, childrenInShare, type ShareItem } from "@/lib/vault-share"
import { VAULT_ZIP_MAX_BYTES, VAULT_ZIP_MAX_FILES, zipStream, zipSegment, type ZipEntry } from "@/lib/vault-zip"

// GET /api/vault/public/<slug>/zip[?folderId=<id>] — everything in a shared folder (or one of its
// subfolders) as one .zip (9 Oct 2026). Only when the link allows downloads.
//
// Exactly what the link shows and nothing else: the same walk as the page (lib/vault-share.ts
// childrenInShare, so nothing in the trash and nothing behind a lock the link's role does not clear).
// Capped at VAULT_ZIP_MAX_FILES files and VAULT_ZIP_MAX_BYTES; past that the answer is 413
// ZIP_TOO_BIG with the totals, and the page says to download files one by one.
//
// `?check=1` answers the same question without the archive — 200 { ok, files, bytes } or the same
// 413 — so the page can say "too big" before sending anybody to a download that would only refuse.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const access = await openShare(slug)
    if (!access.ok) {
      return NextResponse.json({ error: access.error, reason: access.reason }, { status: access.status })
    }
    if (!access.share.allowDownload) {
      return NextResponse.json({ error: "Tautan ini cuma untuk dilihat, tidak bisa diunduh", code: "VIEW_ONLY" }, { status: 403 })
    }
    const top = await itemInShare(access, request.nextUrl.searchParams.get("folderId"))
    if (!top || top.kind !== "FOLDER") return NextResponse.json({ error: "Not found", reason: "missing" }, { status: 404 })

    const rootName = zipSegment(top.name)
    const entries: ZipEntry[] = [{ kind: "folder", name: `${rootName}/`, modified: top.updatedAt }]
    let files = 0
    let bytes = 0
    // Breadth-first over what the link may show. Names are unique per folder in the vault; after
    // making them safe for a desktop two can still meet ("a:b", "a_b"), so the second gets " (2)".
    let frontier: { folder: ShareItem; prefix: string }[] = [{ folder: top, prefix: rootName }]
    for (let depth = 0; frontier.length && depth < 40; depth++) {
      const next: typeof frontier = []
      for (const { folder, prefix } of frontier) {
        const taken = new Set<string>()
        for (const child of await childrenInShare(access, folder)) {
          const safe = zipSegment(child.name)
          const dot = child.kind === "FILE" ? safe.lastIndexOf(".") : -1
          const [stem, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""]
          let segment = safe
          for (let n = 2; taken.has(segment.toLowerCase()); n++) segment = `${stem} (${n})${ext}`
          taken.add(segment.toLowerCase())
          const name = `${prefix}/${segment}`
          if (child.kind === "FOLDER") {
            entries.push({ kind: "folder", name: `${name}/`, modified: child.updatedAt })
            next.push({ folder: child, prefix: name })
          } else if (child.storageKey) {
            files += 1
            bytes += child.size ?? 0
            if (files > VAULT_ZIP_MAX_FILES || bytes > VAULT_ZIP_MAX_BYTES) {
              return NextResponse.json(
                {
                  error: "Terlalu besar untuk satu zip. Unduh berkasnya satu per satu.",
                  code: "ZIP_TOO_BIG",
                  limits: { files: VAULT_ZIP_MAX_FILES, bytes: VAULT_ZIP_MAX_BYTES },
                },
                { status: 413 },
              )
            }
            entries.push({ kind: "file", name, path: storagePath(child.storageKey), modified: child.updatedAt })
          }
        }
      }
      frontier = next
    }

    if (request.nextUrl.searchParams.get("check") === "1") {
      return NextResponse.json({ ok: true, files, bytes }, { headers: { "Cache-Control": "no-store" } })
    }

    const filename = `${top.name.replace(/[\r\n"\\]/g, "").trim() || "Vault"}.zip`
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_")
    return new NextResponse(zipStream(entries), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": access.share.requireAuth ? "private, no-store" : "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("[vault] public zip failed:", error)
    return NextResponse.json({ error: "Failed to make the zip" }, { status: 500 })
  }
}
