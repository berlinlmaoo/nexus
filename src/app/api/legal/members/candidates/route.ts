export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { legalGate } from "@/lib/legal/access"
import { legalInviteCandidates } from "@/lib/legal/members"

/** People the viewer may invite (`?q=` filters by name/email). Empty for someone who can't invite. */
export async function GET(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const q = request.nextUrl.searchParams.get("q") ?? ""
    return NextResponse.json({ candidates: await legalInviteCandidates(gate.actor, q.slice(0, 100)) })
  } catch (error) {
    console.error("Error listing Legal invite candidates:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
