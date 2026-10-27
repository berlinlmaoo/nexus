export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { cleanPath, ogCardFor, ogHeadHtml, ogLang } from "@/lib/og-preview"

// GET /api/og/head?p=<path> — the <head> tags of index.html for a link-preview crawler (src/lib/og-preview.ts).
// nginx includes this answer into the live index.html with SSI (maintenance/phaethon.conf, location
// /__og_page), so a crawler gets the real page with that link's title and description, and a person whose
// browser happens to look like a crawler still gets a working app.
//
// Cookies are never read: a card shows only what a signed-out visitor sees. Answers are kept for a minute in
// memory (a link pasted in a busy group is fetched by every phone's preview at once).

const TTL_MS = 60_000
const MAX_ENTRIES = 500
const cache = new Map<string, { at: number; html: string }>()

export async function GET(request: NextRequest) {
  const path = cleanPath(request.nextUrl.searchParams.get("p"))
  const lang = ogLang(request.headers.get("accept-language"))
  const key = `${lang}:${path}`
  const now = Date.now()
  const hit = cache.get(key)
  let html = hit && now - hit.at < TTL_MS ? hit.html : null
  if (html === null) {
    html = ogHeadHtml(await ogCardFor(path, lang), path, lang)
    if (cache.size >= MAX_ENTRIES) {
      for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k)
      if (cache.size >= MAX_ENTRIES) cache.clear()
    }
    cache.set(key, { at: now, html })
  }
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
