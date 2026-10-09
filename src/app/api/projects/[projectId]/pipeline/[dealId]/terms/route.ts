export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { emitPipelineChanged } from "@/lib/socket-emitter"
import { pipelineToday } from "@/lib/pipeline"
import {
  MAX_TERMS_PER_DEAL,
  dealInclude,
  historyValue,
  parseTermFields,
  pipelineGate,
  serializeDeal,
  serializeTerm,
} from "@/lib/pipeline-server"

type Ctx = { params: Promise<{ projectId: string; dealId: string }> }

/**
 * Add a payment term to a deal (owner, 9 Oct 2026: "perlu per termin"). Same access as editing the deal
 * (pipelineGate "write": the project's members). Body: any of label, amount, dueDate, invoiceNo,
 * invoiceDate, paidAmount, paidAt, note. A blank label becomes "Termin <n>". A payment without a date is
 * dated today (WIB) — "mark paid" without a date still has to say when.
 * → 201 { deal, term }: the whole deal, because its receivable, status and health just changed.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const deal = await prisma.pipelineDeal.findFirst({
      where: { id: dealId, projectId },
      select: { id: true, code: true, name: true, _count: { select: { terms: true } } },
    })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const parsed = parseTermFields(body)
    if (!parsed.ok) return NextResponse.json({ ...parsed.error, code: "INVALID_FIELD" }, { status: 400 })
    if (deal._count.terms >= MAX_TERMS_PER_DEAL) {
      return NextResponse.json({ error: `Maksimal ${MAX_TERMS_PER_DEAL} termin per deal.`, code: "TOO_MANY_TERMS" }, { status: 400 })
    }
    const data = parsed.data
    if (!data.label) data.label = `Termin ${deal._count.terms + 1}`
    if ((data.paidAmount as number | undefined) && !data.paidAt) data.paidAt = new Date(`${pipelineToday()}T00:00:00.000Z`)

    const last = await prisma.pipelinePaymentTerm.findFirst({ where: { dealId }, orderBy: { position: "desc" }, select: { position: true } })
    const term = await prisma.$transaction(async (tx) => {
      const created = await tx.pipelinePaymentTerm.create({
        data: { ...(data as Prisma.PipelinePaymentTermUncheckedCreateInput), dealId, position: (last?.position ?? 0) + 1024 },
      })
      // One history row for the new term, with what it was created as.
      await tx.pipelineDealChange.create({
        data: {
          dealId,
          userId,
          field: "term.created",
          termId: created.id,
          termLabel: created.label,
          after: { amount: created.amount, dueDate: historyValue(created.dueDate), paidAmount: created.paidAmount } as Prisma.InputJsonValue,
        },
      })
      await tx.pipelineDeal.update({ where: { id: dealId }, data: { updatedById: userId } })
      return created
    })

    logAudit({
      action: "create",
      entityType: "pipeline_term",
      entityId: term.id,
      entityName: `${deal.code} · ${term.label}`,
      userId,
      request,
      metadata: { projectId, dealId, amount: term.amount },
    })
    emitPipelineChanged(projectId, dealId, userId)
    const fresh = await prisma.pipelineDeal.findUniqueOrThrow({ where: { id: dealId }, include: dealInclude })
    const today = pipelineToday()
    return NextResponse.json({ deal: serializeDeal(fresh, today), term: serializeTerm(term, today) }, { status: 201 })
  } catch (error) {
    console.error("Error adding payment term:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
