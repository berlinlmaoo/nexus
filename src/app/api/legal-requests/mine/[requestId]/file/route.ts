export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { serveFile } from "@/lib/file-response"
import { requesterDownload } from "@/lib/legal/requests"
import { DOCX_MIME, legalStoragePath, PDF_MIME } from "@/lib/legal/storage"
import { versionDownloadBase } from "@/lib/legal/documents"

type Ctx = { params: Promise<{ requestId: string }> }

/**
 * The FINAL or SIGNED file of MY OWN request (owner, 14 Oct 2026) — nothing else of Legal's is ever served to a
 * requester. The signed copy once signed, else the final version; a PDF when there is one (`?format=docx` for
 * the Word file of a final version). `?inline=1` previews a PDF. Not mine / not final yet: 404.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { requestId } = await params
    const hit = await requesterDownload(session.user.id, requestId)
    if (!hit) return NextResponse.json({ error: "No file to download yet" }, { status: 404 })
    const { doc, v } = hit
    const base = versionDownloadBase(doc, v.version)
    const inline = request.nextUrl.searchParams.get("inline") === "1"
    const wantDocx = request.nextUrl.searchParams.get("format") === "docx"
    if (wantDocx && v.docxKey) return serveFile(request, legalStoragePath(v.docxKey), { filename: `${base}.docx`, mimeType: DOCX_MIME, forceDownload: true })
    if (v.pdfKey) return serveFile(request, legalStoragePath(v.pdfKey), { filename: `${base}.pdf`, mimeType: PDF_MIME, forceDownload: !inline, forceInline: inline })
    if (v.fileKey) {
      const ext = (/\.[A-Za-z0-9]{1,5}$/.exec(v.fileName)?.[0] ?? "").toLowerCase()
      return serveFile(request, legalStoragePath(v.fileKey), { filename: `${base}${ext}`, mimeType: v.mimeType, forceDownload: !inline, forceInline: inline && v.mimeType === PDF_MIME })
    }
    if (v.docxKey) return serveFile(request, legalStoragePath(v.docxKey), { filename: `${base}.docx`, mimeType: DOCX_MIME, forceDownload: true })
    return NextResponse.json({ error: "No file to download yet" }, { status: 404 })
  } catch (error) {
    console.error("Error downloading my Legal request's file:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
