export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { legalActor, legalGate } from "@/lib/legal/access"
import {
  applyStage, generatePrefill, legalMemberUserIds, pingRequestChange, requestInclude, serializeForLegal,
} from "@/lib/legal/requests"
import { isRequestColumn, requestStage, type LinkedDoc } from "@/lib/legal/request-rules"

type Ctx = { params: Promise<{ requestId: string }> }

const notFound = () => NextResponse.json({ error: "Request not found" }, { status: 404 })

/** One request with its answers, the template's field labels, and `prefill` for "Create document". */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { requestId } = await params
    const row = await prisma.legalRequest.findUnique({ where: { id: requestId }, include: requestInclude })
    if (!row) return notFound()
    const [request] = await serializeForLegal(gate.actor, [row], { detail: true })
    return NextResponse.json({ request, prefill: await generatePrefill(gate.actor, row) })
  } catch (error) {
    console.error("Error loading a Legal request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Work a request: `{ column?, picId?, parentDocumentId? }`.
 *   - column: TODO | IN_PROGRESS | DONE (manual drag). Moving a rejected request out of Done reopens it.
 *   - picId: a Legal member, or null.
 *   - parentDocumentId: an addendum request's real parent, a SIGNED document (null to clear).
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { requestId } = await params
    const row = await prisma.legalRequest.findUnique({ where: { id: requestId }, include: requestInclude })
    if (!row) return notFound()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

    const data: Record<string, unknown> = {}
    let reopened = false
    if (body.column !== undefined) {
      if (!isRequestColumn(body.column)) return NextResponse.json({ error: "Unknown column" }, { status: 400 })
      if (body.column !== row.column) {
        data.column = body.column
        data.doneAt = body.column === "DONE" ? new Date() : null
      }
      if (row.rejectedAt && body.column !== "DONE") {
        Object.assign(data, { rejectedAt: null, rejectReason: "", rejectedById: null })
        reopened = true
      }
    }
    if (body.picId !== undefined) {
      const picId = typeof body.picId === "string" && body.picId ? body.picId : null
      if (picId && !(await legalActor(picId))) return NextResponse.json({ error: "The PIC must be someone with Legal access" }, { status: 400 })
      data.picId = picId
    }
    if (body.parentDocumentId !== undefined) {
      if (!row.isAddendum) return NextResponse.json({ error: "Only an addendum request has a parent document" }, { status: 400 })
      const parentId = typeof body.parentDocumentId === "string" && body.parentDocumentId ? body.parentDocumentId : null
      if (parentId) {
        const parent = await prisma.legalDocument.findFirst({ where: { id: parentId, deletedAt: null }, select: { status: true } })
        if (!parent) return NextResponse.json({ error: "Document not found" }, { status: 404 })
        if (parent.status !== "SIGNED") return NextResponse.json({ error: "An addendum is made from a signed document. Pick a signed one." }, { status: 409 })
      }
      data.parentDocumentId = parentId
    }
    if (!Object.keys(data).length) {
      const [same] = await serializeForLegal(gate.actor, [row], { detail: true })
      return NextResponse.json({ request: same })
    }
    const updated = await prisma.legalRequest.update({ where: { id: requestId }, data, include: requestInclude })
    const doc: LinkedDoc = updated.document && !updated.document.deletedAt ? updated.document : null
    await applyStage(updated, requestStage({ column: updated.column, rejectedAt: updated.rejectedAt }, doc), gate.actor.userId)
    await logAudit({
      action: "update",
      entityType: "legal_request",
      entityId: requestId,
      entityName: updated.templateName || "Legal request",
      userId: gate.actor.userId,
      metadata: { changed: Object.keys(body), ...(data.column ? { column: { from: row.column, to: data.column } } : {}), ...(reopened ? { reopened: true } : {}) },
      request,
    })
    pingRequestChange(await legalMemberUserIds(), updated.requesterId, gate.actor.userId)
    const fresh = await prisma.legalRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude })
    const [out] = await serializeForLegal(gate.actor, [fresh], { detail: true })
    return NextResponse.json({ request: out })
  } catch (error) {
    console.error("Error updating a Legal request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
