export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { legalGate } from "@/lib/legal/access"
import { makePdfForVersion } from "@/lib/legal/generate"

type Ctx = { params: Promise<{ documentId: string; version: string }> }

/** (Re)make one version's PDF from its DOCX — after the PDF service was down, or to refresh it. */
export async function POST(_request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { documentId, version } = await params
    const doc = await prisma.legalDocument.findFirst({ where: { id: documentId, deletedAt: null }, select: { id: true } })
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    const error = await makePdfForVersion(documentId, Number(version) || 0)
    if (error) return NextResponse.json({ error }, { status: 502 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error making a Legal PDF:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
