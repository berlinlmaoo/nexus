export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { legalGate, settingsForbidden } from "@/lib/legal/access"
import { isLegalDocType, numberSegment, seriesProblem } from "@/lib/legal/rules"

type Ctx = { params: Promise<{ companyId: string }> }

/** Add a numbering series: `{ docType, label, format, resetPeriod }`. Its key (`<CO>-<LABEL>`) never changes. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const forbidden = settingsForbidden(gate.actor)
    if (forbidden) return forbidden
    const { companyId } = await params
    const company = await prisma.legalCompany.findUnique({ where: { id: companyId }, select: { id: true, code: true, name: true } })
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const docType = String(body?.docType ?? "")
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, 120) : ""
    const format = typeof body?.format === "string" ? body.format.trim() : ""
    const resetPeriod = String(body?.resetPeriod ?? (docType === "INVOICE" ? "MONTH" : "YEAR"))
    if (!isLegalDocType(docType)) return NextResponse.json({ error: "Unknown document type" }, { status: 400 })
    if (!label) return NextResponse.json({ error: "Name is required" }, { status: 400 })
    const problem = seriesProblem(format, resetPeriod)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    const key = `${company.code}-${numberSegment(label).slice(0, 40) || docType}`
    const last = await prisma.legalSeries.findFirst({ where: { companyId }, orderBy: { position: "desc" }, select: { position: true } })
    const series = await prisma.legalSeries.create({
      data: { key, companyId, docType, label, format, resetPeriod, position: (last?.position ?? 0) + 1 },
    })
    await logAudit({ action: "create", entityType: "legal_series", entityId: series.id, entityName: `${company.name}: ${label}`, userId: gate.actor.userId, metadata: { format, resetPeriod }, request })
    return NextResponse.json({ series }, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "A series with that name already exists for this company" }, { status: 409 })
    console.error("Error creating a Legal series:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
