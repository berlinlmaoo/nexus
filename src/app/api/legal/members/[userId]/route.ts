export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { LegalMemberError, revokeLegalMember } from "@/lib/legal/members"

type Ctx = { params: Promise<{ userId: string }> }

/** Remove someone's Legal access. The row stays (revokedAt) so the invite history survives. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { userId } = await params
    const revoked = await revokeLegalMember(gate.actor, userId)
    await logAudit({
      action: "revoke",
      entityType: "legal_member",
      entityId: revoked.userId,
      entityName: revoked.name,
      userId: gate.actor.userId,
      metadata: { targetUserId: revoked.userId, invitedById: revoked.invitedById },
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof LegalMemberError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error revoking a Legal member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
