export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { applyStage, legalMemberUserIds, pingRequestChange, requestInclude, serializeForLegal } from "@/lib/legal/requests"

type Ctx = { params: Promise<{ requestId: string }> }

/**
 * Decline a request: `{ reason }` (required; the requester reads it). It goes to Done with the "Rejected"
 * label. A request whose document is already signed can't be declined.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { requestId } = await params
    const row = await prisma.legalRequest.findUnique({ where: { id: requestId }, include: requestInclude })
    if (!row) return NextResponse.json({ error: "Request not found" }, { status: 404 })
    const body = await request.json().catch(() => null)
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : ""
    if (reason.length < 3) return NextResponse.json({ error: "Write the reason: the requester will read it", fieldErrors: { reason: "Required" } }, { status: 422 })
    if (row.document && !row.document.deletedAt && row.document.status === "SIGNED") {
      return NextResponse.json({ error: "This request's document is already signed" }, { status: 409 })
    }
    const updated = await prisma.legalRequest.update({
      where: { id: requestId },
      data: { rejectedAt: new Date(), rejectReason: reason, rejectedById: gate.actor.userId, column: "DONE", doneAt: new Date() },
      include: requestInclude,
    })
    await applyStage(row, "REJECTED", gate.actor.userId, reason)
    await logAudit({
      action: "update",
      entityType: "legal_request",
      entityId: requestId,
      entityName: row.templateName || "Legal request",
      userId: gate.actor.userId,
      metadata: { rejected: true, reason },
      request,
    })
    pingRequestChange(await legalMemberUserIds(), row.requesterId, gate.actor.userId)
    const [out] = await serializeForLegal(gate.actor, [{ ...updated, stage: "REJECTED" }], { detail: true })
    return NextResponse.json({ request: out })
  } catch (error) {
    console.error("Error declining a Legal request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
