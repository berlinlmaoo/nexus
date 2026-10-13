export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { legalGate, settingsForbidden } from "@/lib/legal/access"
import { companyInclude, serializeCompany } from "@/lib/legal/companies"
import { numberSegment } from "@/lib/legal/rules"

type Ctx = { params: Promise<{ companyId: string }> }

/** name, legalName, address, active; and code while the company has issued no number ({CO} is in them). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const forbidden = settingsForbidden(gate.actor)
    if (forbidden) return forbidden
    const { companyId } = await params
    const company = await prisma.legalCompany.findUnique({ where: { id: companyId }, include: { series: { select: { key: true } } } })
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const data: Prisma.LegalCompanyUpdateInput = {}
    const str = (k: string, max: number) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : undefined)
    if (str("name", 120) !== undefined) {
      if (!str("name", 120)) return NextResponse.json({ error: "Name is required" }, { status: 400 })
      data.name = str("name", 120)
    }
    if (str("legalName", 200) !== undefined) data.legalName = str("legalName", 200)
    if (str("address", 500) !== undefined) data.address = str("address", 500)
    if (typeof body.active === "boolean") data.active = body.active
    if (str("code", 20) !== undefined && str("code", 20) !== company.code) {
      const code = numberSegment(str("code", 20)!).slice(0, 12)
      if (!code) return NextResponse.json({ error: "Code may use letters, digits and -" }, { status: 400 })
      const issued = await prisma.documentNumber.count({ where: { series: { in: company.series.map((s) => s.key) } } })
      if (issued > 0) return NextResponse.json({ error: "The code is printed in numbers already issued, so it can't change" }, { status: 409 })
      data.code = code
    }
    const updated = await prisma.legalCompany.update({ where: { id: companyId }, data, include: companyInclude })
    await logAudit({ action: "update", entityType: "legal_company", entityId: companyId, entityName: updated.name, userId: gate.actor.userId, metadata: { changed: Object.keys(body) }, request })
    return NextResponse.json({ company: serializeCompany(updated) })
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "Another company already has that code" }, { status: 409 })
    console.error("Error updating a Legal company:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
