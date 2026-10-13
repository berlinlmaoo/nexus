export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { LegalVersionError, restoreVersion } from "@/lib/legal/versions"

type Ctx = { params: Promise<{ documentId: string; version: string }> }

/** Restore a version as a new version on top: `{ baseVersion }`. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId, version } = await params
    const body = await request.json().catch(() => ({}))
    const result = await restoreVersion(gate.actor.userId, documentId, Number(version) || 0, Number(body?.baseVersion))
    await logAudit({
      action: "restore",
      entityType: "legal_document",
      entityId: documentId,
      entityName: `v${version} → v${result.version}`,
      userId: gate.actor.userId,
      metadata: { from: Number(version), version: result.version },
      request,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof LegalVersionError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error restoring a Legal document version:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
