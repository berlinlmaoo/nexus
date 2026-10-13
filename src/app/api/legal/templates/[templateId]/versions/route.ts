export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { LEGAL_MAX_TEMPLATE_BYTES } from "@/lib/legal/storage"
import { LegalUploadError, readLegalForm } from "@/lib/legal/uploads"
import { addTemplateVersion, LegalTemplateError, serializeTemplate } from "@/lib/legal/templates"

type Ctx = { params: Promise<{ templateId: string }> }

/** Upload a new version of a template (multipart: file, note?). Documents already made keep their version. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { templateId } = await params
    const form = await readLegalForm(request, LEGAL_MAX_TEMPLATE_BYTES)
    if (!form) return NextResponse.json({ error: "Expected a file upload" }, { status: 400 })
    const template = await addTemplateVersion(gate.actor.userId, templateId, form)
    await logAudit({
      action: "upload",
      entityType: "legal_template",
      entityId: template.id,
      entityName: template.name,
      userId: gate.actor.userId,
      metadata: { version: template.currentVersion },
      request,
    })
    return NextResponse.json({ template: serializeTemplate(template) }, { status: 201 })
  } catch (error) {
    if (error instanceof LegalUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof LegalTemplateError) {
      return NextResponse.json({ error: error.message, problems: error.problems }, { status: error.status })
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: "Someone uploaded a version at the same moment. Try again." }, { status: 409 })
    }
    console.error("Error uploading a Legal template version:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
