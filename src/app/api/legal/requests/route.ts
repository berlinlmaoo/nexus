export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { legalGate } from "@/lib/legal/access"
import { boardWhere, requestInclude, serializeForLegal } from "@/lib/legal/requests"

/**
 * The Legal request board (owner, 14 Oct 2026): every request, newest first. Filters: column, docType,
 * companyId, picId ("none" = unassigned), deadline (overdue | week | none), q. Legal members only.
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const rows = await prisma.legalRequest.findMany({
      where: boardWhere(request.nextUrl.searchParams),
      orderBy: { createdAt: "desc" },
      take: 500,
      include: requestInclude,
    })
    return NextResponse.json({ requests: await serializeForLegal(gate.actor, rows) })
  } catch (error) {
    console.error("Error listing Legal requests:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
