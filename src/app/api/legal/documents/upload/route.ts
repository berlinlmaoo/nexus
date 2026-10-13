export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { dateFromDay } from "@/lib/legal/documents"
import { pdfLater } from "@/lib/legal/generate"
import { isLegalDocType, isLegalStatus } from "@/lib/legal/rules"
import { deleteLegalFile } from "@/lib/legal/storage"
import { LegalUploadError, storeUpload } from "@/lib/legal/uploads"
import { linkProblem } from "@/lib/legal/links"

/**
 * Put a document made elsewhere into the archive (multipart): file, companyId, docType, title, and optional
 * number (as printed on it, e.g. a vendor's invoice number), counterparty, docDate (YYYY-MM-DD), status
 * (default SIGNED), projectId, dealId, notes. It takes no number from Legal's series.
 */
export async function POST(request: NextRequest) {
  let stored: Awaited<ReturnType<typeof storeUpload>> | null = null
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const form = await request.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: "Expected a file upload" }, { status: 400 })
    const s = (k: string, max: number) => (typeof form.get(k) === "string" ? String(form.get(k)).trim().slice(0, max) : "")
    const companyId = s("companyId", 64)
    const docType = s("docType", 20)
    const title = s("title", 200)
    const status = s("status", 10) || "SIGNED"
    const docDate = s("docDate", 10)
    const projectId = s("projectId", 64) || null
    const dealId = s("dealId", 64) || null
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 })
    if (!isLegalDocType(docType)) return NextResponse.json({ error: "Pick the document type" }, { status: 400 })
    if (!isLegalStatus(status)) return NextResponse.json({ error: "Unknown status" }, { status: 400 })
    if (docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return NextResponse.json({ error: "Not a valid date" }, { status: 400 })
    if (!companyId || !(await prisma.legalCompany.findUnique({ where: { id: companyId }, select: { id: true } }))) {
      return NextResponse.json({ error: "Pick the company" }, { status: 400 })
    }
    const badLink = await linkProblem(gate.actor, projectId, dealId)
    if (badLink) return NextResponse.json({ error: badLink }, { status: 404 })

    stored = await storeUpload(form.get("file"))
    const doc = await prisma.legalDocument.create({
      data: {
        companyId,
        number: s("number", 120),
        docType,
        title,
        counterparty: s("counterparty", 200),
        docDate: docDate ? dateFromDay(docDate) : null,
        status,
        source: "UPLOADED",
        notes: s("notes", 5000),
        projectId,
        dealId,
        currentVersion: 1,
        createdById: gate.actor.userId,
        updatedById: gate.actor.userId,
        versions: {
          create: {
            version: 1,
            kind: "UPLOAD",
            docxKey: stored.docxKey,
            pdfKey: stored.pdfKey,
            fileKey: stored.fileKey,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            size: stored.size,
            authorId: gate.actor.userId,
          },
        },
      },
      select: { id: true, number: true, title: true },
    })
    const upload = stored
    stored = null // the document owns the files now
    const pdfError = upload.docx ? pdfLater(doc.id, 1, upload.docx, upload.fileName) : null
    await logAudit({ action: "upload", entityType: "legal_document", entityId: doc.id, entityName: doc.number || doc.title, userId: gate.actor.userId, request })
    return NextResponse.json({ id: doc.id, pdfError }, { status: 201 })
  } catch (error) {
    if (stored) await Promise.all([deleteLegalFile(stored.docxKey), deleteLegalFile(stored.pdfKey), deleteLegalFile(stored.fileKey)])
    if (error instanceof LegalUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error uploading a Legal document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
