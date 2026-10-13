export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { dateFromDay, documentInclude, serializeDocument } from "@/lib/legal/documents"
import { isLegalDocType, isLegalStatus } from "@/lib/legal/rules"
import { linkProblem } from "@/lib/legal/links"

type Ctx = { params: Promise<{ documentId: string }> }

const notFound = () => NextResponse.json({ error: "Document not found" }, { status: 404 })

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    const doc = await prisma.legalDocument.findFirst({ where: { id: documentId, deletedAt: null }, include: documentInclude })
    if (!doc) return notFound()
    return NextResponse.json({ document: serializeDocument(doc) })
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
      data.status = body.status
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
    const updated = await prisma.legalDocument.update({ where: { id: documentId }, data, include: documentInclude })
    await logAudit({
      action: "update",
      entityType: "legal_document",
      entityId: documentId,
      entityName: updated.number || updated.title,
      userId: gate.actor.userId,
      metadata: { changed: Object.keys(body), ...(data.status ? { status: { from: doc.status, to: data.status } } : {}) },
      request,
    })
    return NextResponse.json({ document: serializeDocument(updated) })
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
    if (doc.documentNumberId) {
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
