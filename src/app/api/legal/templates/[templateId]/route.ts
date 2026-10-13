export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { legalGate } from "@/lib/legal/access"
import { applyFieldEdits, type TemplateField } from "@/lib/legal/filters"
import {
  checkCompanyAndSeries, LegalTemplateError, readTemplateMeta, serializeTemplate, templateInclude,
} from "@/lib/legal/templates"

type Ctx = { params: Promise<{ templateId: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { templateId } = await params
    const template = await prisma.legalTemplate.findUnique({ where: { id: templateId }, include: templateInclude })
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 })
    return NextResponse.json({ template: serializeTemplate(template) })
  } catch (error) {
    console.error("Error loading a Legal template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Change name / description / docType / companyId / seriesId / archived, and the current version's field
 * settings (`fields`: labels, types, required, help, options — see applyFieldEdits).
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { templateId } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const template = await prisma.legalTemplate.findUnique({
      where: { id: templateId },
      include: { versions: { orderBy: { version: "desc" } } },
    })
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 })

    const meta = readTemplateMeta(body)
    const companyId = meta.companyId === undefined ? template.companyId : meta.companyId
    // Changing the company drops a series of the old one unless a new series comes along.
    const seriesId = meta.seriesId !== undefined ? meta.seriesId : meta.companyId !== undefined && meta.companyId !== template.companyId ? null : template.seriesId
    await checkCompanyAndSeries(companyId, seriesId)

    const data: Prisma.LegalTemplateUncheckedUpdateInput = { companyId, seriesId }
    if (meta.name !== undefined) {
      if (!meta.name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
      data.name = meta.name
    }
    if (meta.description !== undefined) data.description = meta.description
    if (meta.docType !== undefined) data.docType = meta.docType
    if (typeof body.archived === "boolean") data.archivedAt = body.archived ? template.archivedAt ?? new Date() : null

    const current = template.versions.find((v) => v.version === template.currentVersion)
    await prisma.$transaction(async (tx) => {
      await tx.legalTemplate.update({ where: { id: templateId }, data })
      if (body.fields !== undefined && current) {
        const fields = applyFieldEdits(current.fields as unknown as TemplateField[], body.fields)
        await tx.legalTemplateVersion.update({ where: { id: current.id }, data: { fields: fields as unknown as Prisma.InputJsonValue } })
      }
    })
    const updated = await prisma.legalTemplate.findUniqueOrThrow({ where: { id: templateId }, include: templateInclude })
    await logAudit({
      action: typeof body.archived === "boolean" ? (body.archived ? "archive" : "restore") : "update",
      entityType: "legal_template",
      entityId: templateId,
      entityName: updated.name,
      userId: gate.actor.userId,
      metadata: { changed: Object.keys(body) },
      request,
    })
    return NextResponse.json({ template: serializeTemplate(updated) })
  } catch (error) {
    if (error instanceof LegalTemplateError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error updating a Legal template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
