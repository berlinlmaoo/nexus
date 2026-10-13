export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { legalGate } from "@/lib/legal/access"
import { compareVersions, LegalVersionError } from "@/lib/legal/versions"

type Ctx = { params: Promise<{ documentId: string }> }

/** `?a=1&b=3`: what changed from version a to version b, paragraph by paragraph (word-level inside). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    const sp = request.nextUrl.searchParams
    return NextResponse.json(await compareVersions(documentId, Number(sp.get("a")) || 0, Number(sp.get("b")) || 0))
  } catch (error) {
    if (error instanceof LegalVersionError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error comparing Legal document versions:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
