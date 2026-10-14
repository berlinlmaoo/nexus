export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { ensureRequestLinks, serializeLink } from "@/lib/legal/requests"

type Ctx = { params: Promise<{ scope: string }> }

/** Open or close a link for new requests: `{ accepting }`. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { scope } = await params
    const body = await request.json().catch(() => null)
    if (typeof body?.accepting !== "boolean") return NextResponse.json({ error: "accepting is required" }, { status: 400 })
    await ensureRequestLinks(gate.actor.userId)
    const link = await prisma.legalRequestLink.findUnique({ where: { scope } })
    if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 })
    const updated = await prisma.legalRequestLink.update({
      where: { scope },
      data: { accepting: body.accepting },
      include: { company: { select: { id: true, code: true, name: true, active: true } } },
    })
    await logAudit({ action: "update", entityType: "legal_request_link", entityId: link.id, entityName: updated.company?.name ?? "General", userId: gate.actor.userId, metadata: { accepting: body.accepting }, request })
    return NextResponse.json({ link: serializeLink(updated) })
  } catch (error) {
    console.error("Error updating a Legal request link:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
