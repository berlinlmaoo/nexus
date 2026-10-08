export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { canThumbnail } from "@/lib/vault"
import { openShare, PUBLIC_BASE, shareBase } from "@/lib/vault-share"

// GET /api/vault/og/<slug> — the page a chat app's link preview reads for an EXTERNAL Z Vault link
// (owner, 9 Oct 2026: WhatsApp and iMessage showed a bare URL).
//
// The web app is a static SPA, so `/s/<slug>` itself can carry no per-link meta. nginx sends link-
// preview crawlers (by user agent) for `/s/<slug>` here instead of to the SPA — the rewrite lives in
// maintenance/phaethon.conf — and people keep getting the SPA. This answers with a small HTML page:
// og:/twitter: tags and nothing else worth rendering.
//
// Only an external link that opens right now gets its file's name and picture. An internal link, a
// revoked, expired or trashed one, or one that does not exist all get the same generic card — no
// name leaks through a preview, and the answer does not tell them apart. Never counted as a view: a
// crawler fetching a preview is not somebody opening the file.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function humanSize(bytes: number | null | undefined): string {
  if (bytes == null) return ""
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

const COPY = {
  en: {
    generic: "A file shared from NEXUS",
    genericDesc: "Open the link to see it.",
    folder: "Folder",
    sharedBy: (name: string) => `Shared by ${name}`,
    via: "Z Vault · NEXUS",
  },
  id: {
    generic: "Berkas yang dibagikan dari NEXUS",
    genericDesc: "Buka tautannya untuk melihat.",
    folder: "Folder",
    sharedBy: (name: string) => `Dibagikan oleh ${name}`,
    via: "Z Vault · NEXUS",
  },
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // Indonesian unless the crawler asks for English — the same default as the web app.
  const lang = (request.headers.get("accept-language") || "").trim().toLowerCase().startsWith("en") ? "en" : "id"
  const c = COPY[lang]
  const safeSlug = /^[A-Za-z0-9_-]{1,64}$/.test(slug) ? slug : ""
  const pageUrl = `${PUBLIC_BASE}/s/${safeSlug}`

  let title = c.generic
  let description = c.genericDesc
  let image = `${PUBLIC_BASE}/apple-touch-icon.png`
  let large = false

  if (safeSlug) {
    try {
      const access = await openShare(safeSlug)
      if (access.ok && !access.share.requireAuth) {
        const { share } = access
        const item = share.item
        title = item.name
        const parts: string[] = []
        if (item.kind === "FOLDER") parts.push(c.folder)
        else if (item.size != null) parts.push(humanSize(item.size))
        if (share.sharedBy?.name) parts.push(c.sharedBy(share.sharedBy.name))
        parts.push(c.via)
        description = parts.join(" · ")
        if (item.kind === "FILE" && canThumbnail(item.mimeType, item.name)) {
          image = `${PUBLIC_BASE}${shareBase(safeSlug)}/thumb?w=640`
          large = true
        }
      }
    } catch (error) {
      console.error("[vault] og failed:", error)
    }
  }

  const t = escapeHtml(title)
  const d = escapeHtml(description)
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="NEXUS">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="${large ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${escapeHtml(image)}">
</head>
<body><p><a href="${escapeHtml(pageUrl)}">${t}</a></p></body>
</html>
`
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // A revoke must reach the next preview: nothing keeps this.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
