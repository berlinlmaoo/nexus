export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { legalGate } from "@/lib/legal/access"

/** Who I am in Legal: 403 when not invited (so it doubles as the access probe), else my invite power. */
export async function GET() {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { actor } = gate
    return NextResponse.json({ access: true, isRoot: actor.isRoot, invitePower: actor.power })
  } catch (error) {
    console.error("Error loading Legal access:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
