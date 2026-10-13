export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { LegalGideonError, listProposals, requestProposal } from "@/lib/legal/gideon-edit"
import { LegalVersionError } from "@/lib/legal/versions"

type Ctx = { params: Promise<{ documentId: string }> }

/** Recent GIDEON proposals on this document, newest first. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    return NextResponse.json({ proposals: await listProposals(documentId) })
  } catch (error) {
    console.error("Error listing Legal GIDEON proposals:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Ask GIDEON for a precise change: `{ baseVersion, instruction, targets?: number[], replyTo?, answer? }`.
 * Answers with the proposal: PENDING (before → after, waiting for Approve), CLARIFY (GIDEON's question) or
 * FAILED (why it was refused). Nothing in the document changes here.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const proposal = await requestProposal(gate.actor, documentId, {
      baseVersion: Number(body.baseVersion),
      instruction: typeof body.instruction === "string" ? body.instruction : "",
      targets: Array.isArray(body.targets) ? body.targets.map(Number) : [],
      replyTo: typeof body.replyTo === "string" ? body.replyTo : undefined,
      answer: typeof body.answer === "string" ? body.answer : undefined,
    })
    await logAudit({
      action: "create",
      entityType: "legal_document",
      entityId: documentId,
      entityName: `GIDEON proposal (${proposal.status})`,
      userId: gate.actor.userId,
      metadata: { proposalId: proposal.id, status: proposal.status },
      request,
    })
    return NextResponse.json({ proposal }, { status: 201 })
  } catch (error) {
    if (error instanceof LegalGideonError || error instanceof LegalVersionError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error asking GIDEON for a Legal edit:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
