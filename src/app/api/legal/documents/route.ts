export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { generateLegalDocument, LegalGenerateError } from "@/lib/legal/generate"
import { listDocuments } from "@/lib/legal/archive"

/** The archive: every legal document, filtered (see lib/legal/archive.ts for the parameters). */
export async function GET(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    return NextResponse.json(await listDocuments(request.nextUrl.searchParams))
  } catch (error) {
    console.error("Error listing Legal documents:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Make a document from a template: `{ templateId, companyId?, values, title?, counterparty?, projectId?, dealId? }`.
 * 422 carries `fieldErrors` (by field name) or `problems` (the template); nothing is numbered then.
 */
export async function POST(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const body = await request.json().catch(() => null)
    if (!body || typeof body.templateId !== "string") return NextResponse.json({ error: "templateId is required" }, { status: 400 })
    const made = await generateLegalDocument(gate.actor, {
      templateId: body.templateId,
      companyId: typeof body.companyId === "string" ? body.companyId : null,
      values: body.values,
      title: typeof body.title === "string" ? body.title : undefined,
      counterparty: typeof body.counterparty === "string" ? body.counterparty : undefined,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      dealId: typeof body.dealId === "string" ? body.dealId : null,
    })
    await logAudit({
      action: "create",
      entityType: "legal_document",
      entityId: made.id,
      entityName: made.number,
      userId: gate.actor.userId,
      metadata: { templateId: body.templateId, number: made.number },
      request,
    })
    return NextResponse.json({ id: made.id, number: made.number, pdfError: made.pdfError }, { status: 201 })
  } catch (error) {
    if (error instanceof LegalGenerateError) {
      return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors, problems: error.problems }, { status: error.status })
    }
    console.error("Error generating a Legal document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
