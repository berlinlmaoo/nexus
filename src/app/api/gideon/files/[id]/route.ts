export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { gideonFileBytes, gideonFileFor } from "@/lib/gideon-files"

/**
 * GET /api/gideon/files/:id — a file GIDEON made for you (PDF / DOCX / XLSX, 18 Oct 2026), as a download.
 * Only the person it was made for; 404 for anyone else, an unknown id or one older than 30 days.
 * `?inline=1` lets a PDF open in the browser's viewer.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const meta = await gideonFileFor(session.user.id, id)
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const bytes = await gideonFileBytes(meta).catch(() => null)
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const inline = req.nextUrl.searchParams.get("inline") === "1" && meta.ext === "pdf"
  const ascii = meta.name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'")
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": meta.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
