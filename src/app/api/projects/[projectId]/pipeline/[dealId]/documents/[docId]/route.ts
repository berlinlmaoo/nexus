export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { pipelineToday } from "@/lib/pipeline"
import { dealInclude, pipelineGate, serializeDeal } from "@/lib/pipeline-server"
import { isFileDoc, pipelineFilePath, removeDocument, storedDocs } from "@/lib/pipeline-documents"

type Ctx = { params: Promise<{ projectId: string; dealId: string; docId: string }> }

/**
 * An attached file's bytes (owner, 9 Oct 2026). The board is members-only, so its files are too: the
 * project's read rule (pipelineGate → checkProjectAccess VIEWER) on every request, not the bare session
 * check of /api/files. Images and PDFs open inline (serveFile decides from the stored type, never an
 * unsafe one); `?download=1` saves instead. The real file name rides on Content-Disposition.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId, dealId, docId } = await params
    const gate = await pipelineGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const deal = await prisma.pipelineDeal.findFirst({ where: { id: dealId, projectId }, select: { links: true } })
    const doc = deal ? storedDocs(deal.links).find((d) => d.id === docId) : undefined
    if (!doc || !isFileDoc(doc)) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    return serveFile(request, pipelineFilePath(doc.file), {
      filename: doc.fileName,
      mimeType: doc.mimeType,
      forceDownload: request.nextUrl.searchParams.has("download"),
      // One id is one upload for good (a file is never replaced in place), so the bytes behind this URL
      // never change and the clients' URL-keyed caches stay right.
      etag: `"${docId}"`,
    })
  } catch (error) {
    console.error("Error serving pipeline document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Takes a document (a link or a file) off the deal → the deal. The file stays on disk: the history row
 * "document.removed" keeps the entry, and the 90-day purge removes the bytes once nothing refers to them
 * (Audit restore rule, owner 8 Oct 2026). Realtime and audit as for any deal edit.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId, docId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const removed = await removeDocument({ projectId, dealId, docId, userId, request })
    if (!removed) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    const fresh = await prisma.pipelineDeal.findFirst({ where: { id: dealId, projectId }, include: dealInclude })
    if (!fresh) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
    return NextResponse.json({ deal: serializeDeal(fresh, pipelineToday()) })
  } catch (error) {
    console.error("Error removing pipeline document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
