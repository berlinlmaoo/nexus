export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { requestAttachment } from "@/lib/legal/requests"
import { legalStoragePath, PDF_MIME } from "@/lib/legal/storage"

type Ctx = { params: Promise<{ requestId: string; attachmentId: string }> }

/** A file I attached to my own Legal request. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { requestId, attachmentId } = await params
    const r = await prisma.legalRequest.findFirst({ where: { id: requestId, requesterId: session.user.id }, select: { attachments: true } })
    const a = r ? requestAttachment(r, attachmentId) : null
    if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const inline = request.nextUrl.searchParams.get("inline") === "1"
    return serveFile(request, legalStoragePath(a.storageKey!), { filename: a.fileName, mimeType: a.mimeType, forceDownload: !inline, forceInline: inline && (a.mimeType === PDF_MIME || a.mimeType.startsWith("image/")) })
  } catch (error) {
    console.error("Error downloading a Legal request attachment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
