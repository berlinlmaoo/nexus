export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { legalGate } from "@/lib/legal/access"
import { requestAttachment } from "@/lib/legal/requests"
import { legalStoragePath, PDF_MIME } from "@/lib/legal/storage"

type Ctx = { params: Promise<{ requestId: string; attachmentId: string }> }

/** A file the requester attached (`?inline=1` previews a PDF or photo). Legal members only. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { requestId, attachmentId } = await params
    const r = await prisma.legalRequest.findUnique({ where: { id: requestId }, select: { attachments: true } })
    const a = r ? requestAttachment(r, attachmentId) : null
    if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const inline = request.nextUrl.searchParams.get("inline") === "1"
    return serveFile(request, legalStoragePath(a.storageKey!), { filename: a.fileName, mimeType: a.mimeType, forceDownload: !inline, forceInline: inline && (a.mimeType === PDF_MIME || a.mimeType.startsWith("image/")) })
  } catch (error) {
    console.error("Error downloading a Legal request attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
