export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { legalGate } from "@/lib/legal/access"
import { ensureRequestLinks, serializeLink } from "@/lib/legal/requests"

/** The request links: the general one, then one per active company (made on first use). Legal members only. */
export async function GET() {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    return NextResponse.json({ links: (await ensureRequestLinks(gate.actor.userId)).map(serializeLink) })
  } catch (error) {
    console.error("Error listing Legal request links:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
