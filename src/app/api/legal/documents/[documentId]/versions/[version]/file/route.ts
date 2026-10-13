export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { legalGate } from "@/lib/legal/access"
import { DOCX_MIME, legalStoragePath, PDF_MIME } from "@/lib/legal/storage"

type Ctx = { params: Promise<{ documentId: string; version: string }> }

/**
 * One version's file: `?format=docx` (default when there is one), `pdf`, or `original` (an upload as it
 * came). `?inline=1` previews a PDF in the browser instead of downloading it.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId, version } = await params
    const v = await prisma.legalDocumentVersion.findFirst({
      where: { documentId, version: Number(version) || 0, document: { deletedAt: null } },
    })
    if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const format = request.nextUrl.searchParams.get("format") ?? (v.docxKey ? "docx" : v.fileKey ? "original" : "pdf")
    const inline = request.nextUrl.searchParams.get("inline") === "1"
    const base = v.fileName.replace(/\.(docx|pdf)$/i, "")
    if (format === "docx" && v.docxKey) {
      return serveFile(request, legalStoragePath(v.docxKey), { filename: `${base}.docx`, mimeType: DOCX_MIME, forceDownload: true })
    }
    if (format === "pdf" && v.pdfKey) {
      return serveFile(request, legalStoragePath(v.pdfKey), { filename: `${base}.pdf`, mimeType: PDF_MIME, forceDownload: !inline, forceInline: inline })
    }
    if (format === "original" && v.fileKey) {
      return serveFile(request, legalStoragePath(v.fileKey), { filename: v.fileName, mimeType: v.mimeType, forceDownload: !inline, forceInline: inline && v.mimeType === PDF_MIME })
    }
    return NextResponse.json({ error: "This version has no such file" }, { status: 404 })
  } catch (error) {
    console.error("Error downloading a Legal document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
