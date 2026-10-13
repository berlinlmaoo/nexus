export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { legalGate } from "@/lib/legal/access"
import { LegalGenerateError, prepareDocument } from "@/lib/legal/generate"

/** The New document form for `{ templateId, companyId?, values? }`: its fields, series and number preview. */
export async function POST(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const body = await request.json().catch(() => null)
    if (!body || typeof body.templateId !== "string") return NextResponse.json({ error: "templateId is required" }, { status: 400 })
    return NextResponse.json(await prepareDocument({ templateId: body.templateId, companyId: body.companyId ?? null, values: body.values }))
  } catch (error) {
    if (error instanceof LegalGenerateError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error preparing a Legal document:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
