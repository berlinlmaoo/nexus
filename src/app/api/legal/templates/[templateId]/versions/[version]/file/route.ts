export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { legalGate } from "@/lib/legal/access"
import { DOCX_MIME, legalStoragePath } from "@/lib/legal/storage"

type Ctx = { params: Promise<{ templateId: string; version: string }> }

/** Download one version of a template's .docx. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { templateId, version } = await params
    const v = await prisma.legalTemplateVersion.findUnique({
      where: { templateId_version: { templateId, version: Number(version) || 0 } },
      select: { storageKey: true, fileName: true },
    })
    if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return serveFile(request, legalStoragePath(v.storageKey), { filename: v.fileName, mimeType: DOCX_MIME, forceDownload: true })
  } catch (error) {
    console.error("Error downloading a Legal template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
