export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { dateFromDay, documentInclude, serializeDocument } from "@/lib/legal/documents"
import { isLegalDocType, isLegalStatus, releasesNumberOnVoid, statusChangeProblem } from "@/lib/legal/rules"
import { releaseLegalNumber } from "@/lib/legal/numbering"
import { linkProblem, redactLinks } from "@/lib/legal/links"
import { syncRequestForDocument } from "@/lib/legal/requests"

type Ctx = { params: Promise<{ documentId: string }> }

class StatusRace extends Error {}

const notFound = () => NextResponse.json({ error: "Document not found" }, { status: 404 })

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    const doc = await prisma.legalDocument.findFirst({ where: { id: documentId, deletedAt: null }, include: documentInclude })
    if (!doc) return notFound()
    const [document] = await redactLinks(gate.actor, [serializeDocument(doc)])
    return NextResponse.json({ document })
  } catch (error) {
    console.error("Error loading a Legal document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Archive fields: title, counterparty, status, notes, projectId, dealId, finalVersion; and for an uploaded
 * document also number, docType and docDate (a generated one's number, type and date are what its number
 * was issued for, so they don't move).
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    const doc = await prisma.legalDocument.findFirst({ where: { id: documentId, deletedAt: null } })
    if (!doc) return notFound()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const data: Prisma.LegalDocumentUncheckedUpdateInput = { updatedById: gate.actor.userId }
    const str = (k: string, max: number) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : undefined)

    const title = str("title", 200)
    if (title !== undefined) {
      if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 })
      data.title = title
    }
    if (str("counterparty", 200) !== undefined) data.counterparty = str("counterparty", 200)
    if (str("notes", 5000) !== undefined) data.notes = str("notes", 5000)
    if (body.status !== undefined) {
      if (!isLegalStatus(body.status)) return NextResponse.json({ error: "Unknown status" }, { status: 400 })
      const problem = statusChangeProblem(doc.status, body.status, { source: doc.source })
      if (problem) return NextResponse.json({ error: problem, code: "LEGAL_STATUS_LOCKED" }, { status: 409 })
      if (body.status !== doc.status) {
        data.status = body.status
        if (body.status === "VOID") data.voidedAt = new Date()
        if (body.status === "SIGNED") Object.assign(data, { signedAt: new Date(), signedById: gate.actor.userId })
      }
    }
    if (body.projectId !== undefined) {
      const id = typeof body.projectId === "string" && body.projectId ? body.projectId : null
      const bad = await linkProblem(gate.actor, id, null)
      if (bad) return NextResponse.json({ error: bad }, { status: 404 })
      data.projectId = id
    }
    if (body.dealId !== undefined) {
      const id = typeof body.dealId === "string" && body.dealId ? body.dealId : null
      const bad = await linkProblem(gate.actor, null, id)
      if (bad) return NextResponse.json({ error: bad }, { status: 404 })
      data.dealId = id
    }
    if (body.finalVersion !== undefined) {
      const v = body.finalVersion === null ? null : Number(body.finalVersion)
      if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= doc.currentVersion)) return NextResponse.json({ error: "No such version" }, { status: 400 })
      data.finalVersion = v
    }
    if (doc.source === "UPLOADED") {
      if (str("number", 120) !== undefined) data.number = str("number", 120)
      if (body.docType !== undefined) {
        if (!isLegalDocType(body.docType)) return NextResponse.json({ error: "Unknown document type" }, { status: 400 })
        data.docType = body.docType
      }
      if (body.docDate !== undefined) {
        const d = typeof body.docDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.docDate) ? body.docDate : null
        if (body.docDate && !d) return NextResponse.json({ error: "Not a valid date" }, { status: 400 })
        data.docDate = d ? dateFromDay(d) : null
      }
    }
    // VOID gives an unsigned document's number back to its series (owner, 14 Oct 2026), in the same
    // transaction and under the same lock as allocation. Only when the status still is what we read.
    let released = false
    const updated = await prisma.$transaction(async (tx) => {
      if (data.status) {
        const moved = await tx.legalDocument.updateMany({ where: { id: documentId, status: doc.status }, data: { status: data.status } })
        if (moved.count !== 1) throw new StatusRace()
      }
      if (data.status === "VOID" && releasesNumberOnVoid(doc)) {
        await releaseLegalNumber(tx, { id: doc.id, documentNumberId: doc.documentNumberId! })
        if (doc.parentDocumentId) data.addendumSeq = null
        released = true
      }
      return tx.legalDocument.update({ where: { id: documentId }, data, include: documentInclude })
    }).catch((error) => {
      if (error instanceof StatusRace) return null
      throw error
    })
    if (!updated) return NextResponse.json({ error: "Someone changed this document meanwhile. Reload to see it." }, { status: 409 })
    await logAudit({
      action: "update",
      entityType: "legal_document",
      entityId: documentId,
      entityName: updated.number || updated.title,
      userId: gate.actor.userId,
      metadata: { changed: Object.keys(body), ...(data.status ? { status: { from: doc.status, to: data.status } } : {}), ...(released ? { numberReleased: doc.number } : {}) },
      request,
    })
    // Final, sent, void or a new final version: a request this document was made for follows.
    if (data.status || data.finalVersion !== undefined) await syncRequestForDocument(documentId, gate.actor.userId)
    const [document] = await redactLinks(gate.actor, [serializeDocument(updated)])
    return NextResponse.json({ document })
  } catch (error) {
    console.error("Error updating a Legal document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Remove an UPLOADED document from the archive. A numbered one is never removed: set it to VOID instead,
 *  so its number stays accounted for. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    const doc = await prisma.legalDocument.findFirst({ where: { id: documentId, deletedAt: null } })
    if (!doc) return notFound()
    // A generated document had a number even after voiding gave it back: it stays in the archive.
    if (doc.documentNumberId || doc.source === "GENERATED" || doc.parentDocumentId) {
      return NextResponse.json({ error: "A numbered document can't be deleted. Set its status to Void instead." }, { status: 409 })
    }
    await prisma.legalDocument.update({ where: { id: documentId }, data: { deletedAt: new Date(), updatedById: gate.actor.userId } })
    await logAudit({ action: "delete", entityType: "legal_document", entityId: documentId, entityName: doc.number || doc.title, userId: gate.actor.userId, request })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting a Legal document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
