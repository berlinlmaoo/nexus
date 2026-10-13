export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { legalGate } from "@/lib/legal/access"
import { searchLinks } from "@/lib/legal/links"

/** Projects and Pipeline deals the viewer can open, to link a document to (`?q=` filters by name/code). */
export async function GET(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    return NextResponse.json(await searchLinks(gate.actor, request.nextUrl.searchParams.get("q") ?? ""))
  } catch (error) {
    console.error("Error searching Legal links:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
