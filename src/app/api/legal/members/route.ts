export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { inviteLegalMember, LegalMemberError, listLegalMembers } from "@/lib/legal/members"

/** Everyone who has (or had) Legal, with who invited and who removed them. */
export async function GET() {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const members = await listLegalMembers(gate.actor)
    return NextResponse.json({ members, invitePower: gate.actor.power })
  } catch (error) {
    console.error("Error listing Legal members:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Invite someone: `{ userId }`. Root: anyone of the company; an invited BoD member: staff only. */
export async function POST(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const body = await request.json().catch(() => null)
    const userId = typeof body?.userId === "string" ? body.userId : ""
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })
    const invited = await inviteLegalMember(gate.actor, userId)
    await logAudit({
      action: "invite",
      entityType: "legal_member",
      entityId: invited.userId,
      entityName: invited.name,
      userId: gate.actor.userId,
      metadata: { targetUserId: invited.userId, targetOrgRole: invited.orgRole, reinvited: invited.reinvited },
      request,
    })
    return NextResponse.json({ ok: true, userId: invited.userId }, { status: 201 })
  } catch (error) {
    if (error instanceof LegalMemberError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error inviting a Legal member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
