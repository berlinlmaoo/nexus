export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { legalGate } from "@/lib/legal/access"
import { documentParagraphs, LegalVersionError } from "@/lib/legal/versions"

type Ctx = { params: Promise<{ documentId: string }> }

/** The body paragraphs of a Word version (`?version=`, default the current one) for review and editing. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId } = await params
    const v = request.nextUrl.searchParams.get("version")
    return NextResponse.json(await documentParagraphs(documentId, v ? Number(v) || 0 : undefined))
  } catch (error) {
    if (error instanceof LegalVersionError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error reading Legal document paragraphs:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
