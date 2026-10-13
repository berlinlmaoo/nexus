export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { decideProposal, LegalGideonError } from "@/lib/legal/gideon-edit"
import { LegalVersionError } from "@/lib/legal/versions"

type Ctx = { params: Promise<{ documentId: string; proposalId: string }> }

/** `{ decision: "approve" | "discard", indexes?: number[] }` — approve applies the (chosen) changes as a new version. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId, proposalId } = await params
    const body = await request.json().catch(() => null)
    const decision = body?.decision
    if (decision !== "approve" && decision !== "discard") return NextResponse.json({ error: "decision must be approve or discard" }, { status: 400 })
    // Absent = every change; present = exactly these, and an empty or unreadable list is refused.
    const indexes = Array.isArray(body.indexes) ? body.indexes.map(Number).filter(Number.isInteger) : undefined
    if (body.indexes !== undefined && !indexes?.length) return NextResponse.json({ error: "Pick at least one change to apply" }, { status: 400 })
    const result = await decideProposal(gate.actor, documentId, proposalId, decision, indexes)
    await logAudit({
      action: decision === "approve" ? "approve" : "reject",
      entityType: "legal_document",
      entityId: documentId,
      entityName: decision === "approve" ? `GIDEON proposal → v${result.version}` : "GIDEON proposal",
      userId: gate.actor.userId,
      metadata: { proposalId, version: result.version, indexes },
      request,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof LegalGideonError || error instanceof LegalVersionError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error deciding a Legal GIDEON proposal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
