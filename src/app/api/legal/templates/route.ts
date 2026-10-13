export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { createTemplate, LegalTemplateError, serializeTemplate, templateInclude } from "@/lib/legal/templates"

/** Templates, newest first. `?docType=`, `?companyId=` (also matches company-less templates), `?archived=1`. */
export async function GET(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const sp = request.nextUrl.searchParams
    const where: Prisma.LegalTemplateWhereInput = {}
    if (sp.get("archived") !== "1") where.archivedAt = null
    if (sp.get("docType")) where.docType = sp.get("docType")!
    if (sp.get("companyId")) where.OR = [{ companyId: sp.get("companyId")! }, { companyId: null }]
    const rows = await prisma.legalTemplate.findMany({ where, include: templateInclude, orderBy: [{ updatedAt: "desc" }] })
    return NextResponse.json({ templates: rows.map(serializeTemplate) })
  } catch (error) {
    console.error("Error listing Legal templates:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Upload a template (multipart: file, name, docType, companyId?, seriesId?, description?). */
export async function POST(request: NextRequest) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const form = await request.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: "Expected a file upload" }, { status: 400 })
    const template = await createTemplate(gate.actor.userId, form)
    await logAudit({
      action: "create",
      entityType: "legal_template",
      entityId: template.id,
      entityName: template.name,
      userId: gate.actor.userId,
      metadata: { docType: template.docType, version: 1 },
      request,
    })
    return NextResponse.json({ template: serializeTemplate(template) }, { status: 201 })
  } catch (error) {
    if (error instanceof LegalTemplateError) {
      return NextResponse.json({ error: error.message, problems: error.problems }, { status: error.status })
    }
    console.error("Error uploading a Legal template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
