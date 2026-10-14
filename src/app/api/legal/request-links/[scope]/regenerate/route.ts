export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { ensureRequestLinks, newLinkToken, serializeLink } from "@/lib/legal/requests"

type Ctx = { params: Promise<{ scope: string }> }

/** A new token for the link: the old URL stops working at once (404 LEGAL_LINK_UNKNOWN). */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { scope } = await params
    await ensureRequestLinks(gate.actor.userId)
    const link = await prisma.legalRequestLink.findUnique({ where: { scope } })
    if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 })
    const updated = await prisma.legalRequestLink.update({
      where: { scope },
      data: { token: newLinkToken(), rotatedAt: new Date(), rotatedById: gate.actor.userId },
      include: { company: { select: { id: true, code: true, name: true, active: true } } },
    })
    await logAudit({ action: "update", entityType: "legal_request_link", entityId: link.id, entityName: updated.company?.name ?? "General", userId: gate.actor.userId, metadata: { regenerated: true }, request })
    return NextResponse.json({ link: serializeLink(updated) })
  } catch (error) {
    console.error("Error regenerating a Legal request link:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
