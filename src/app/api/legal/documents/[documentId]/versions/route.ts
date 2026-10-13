export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { LegalUploadError } from "@/lib/legal/uploads"
import { LegalVersionError, saveParagraphEdits, uploadVersion } from "@/lib/legal/versions"

type Ctx = { params: Promise<{ documentId: string }> }

/**
 * A new version. JSON `{ baseVersion, edits: [{ index, text }], note? }` = edited paragraphs; multipart
 * (file, baseVersion, note?, status?) = an uploaded file (e.g. the signed scan). 409 when `baseVersion` is no
 * longer the current one.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    const multipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data")
    let result: { version: number; pdfError: string | null }
    if (multipart) {
      const form = await request.formData().catch(() => null)
      if (!form) return NextResponse.json({ error: "Expected a file upload" }, { status: 400 })
      result = await uploadVersion(gate.actor.userId, documentId, form)
    } else {
      const body = await request.json().catch(() => null)
      if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
      const edits = Array.isArray(body.edits) ? body.edits.map((e: { index?: unknown; text?: unknown }) => ({ index: Number(e?.index), text: String(e?.text ?? "") })) : []
      result = await saveParagraphEdits(gate.actor.userId, documentId, { baseVersion: Number(body.baseVersion), edits, note: typeof body.note === "string" ? body.note : "" })
    }
    await logAudit({
      action: multipart ? "upload" : "update",
      entityType: "legal_document",
      entityId: documentId,
      entityName: `v${result.version}`,
      userId: gate.actor.userId,
      metadata: { version: result.version, kind: multipart ? "UPLOAD" : "MANUAL" },
      request,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof LegalVersionError || error instanceof LegalUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error saving a Legal document version:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
