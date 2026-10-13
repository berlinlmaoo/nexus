export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { legalGate } from "@/lib/legal/access"
import { listCompanies } from "@/lib/legal/companies"

/** The issuing companies with their numbering series. */
export async function GET() {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    return NextResponse.json({ companies: await listCompanies() })
  } catch (error) {
    console.error("Error listing Legal companies:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
