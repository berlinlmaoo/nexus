export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { emitPipelineChanged } from "@/lib/socket-emitter"
import { pipelineToday } from "@/lib/pipeline"
import { DOUBLE_TAP_MS, readIdempotencyKey } from "@/lib/idempotency"
import {
  MAX_TERMS_PER_DEAL,
  dealInclude,
  historyValue,
  parseTermFields,
  pipelineGate,
  sameValue,
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
 *
 * Race audit 16 Oct 2026, M7: the count, the default label and the position were read before the insert
 * with no lock, so a double tap stored two terms and two people adding at once got the same "Termin n"
 * and the same position. Now it all happens under the deal's row lock (SELECT … FOR UPDATE), and:
 *  - `clientRequestId` (or the Idempotency-Key header): the same key on the same deal stores one term; a
 *    repeat answers 200 { deal, term, duplicate: true };
 *  - no key (every app before this): the very same term added by the same person in the last 10 s is
 *    taken as a double tap and answered the same way.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const deal = await prisma.pipelineDeal.findFirst({ where: { id: dealId, projectId }, select: { id: true, code: true, name: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const idem = readIdempotencyKey(request, body.clientRequestId)
    if (!idem.ok) return idem.response
    const parsed = parseTermFields(body)
    if (!parsed.ok) return NextResponse.json({ ...parsed.error, code: "INVALID_FIELD" }, { status: 400 })
    const data = parsed.data
    const sentKeys = Object.keys(data)
    if ((data.paidAmount as number | undefined) && !data.paidAt) data.paidAt = new Date(`${pipelineToday()}T00:00:00.000Z`)

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PipelineDeal" WHERE id = ${dealId} FOR UPDATE`
      if (idem.key) {
        const seen = await tx.pipelinePaymentTerm.findFirst({ where: { dealId, clientRequestId: idem.key } })
        if (seen) return { term: seen, duplicate: true as const }
      } else {
        const recent = await tx.pipelineDealChange.findFirst({
          where: { dealId, userId, field: "term.created", createdAt: { gte: new Date(Date.now() - DOUBLE_TAP_MS) } },
          orderBy: { createdAt: "desc" },
          select: { termId: true },
        })
        const prev = recent?.termId ? await tx.pipelinePaymentTerm.findUnique({ where: { id: recent.termId } }) : null
        if (prev && !prev.clientRequestId && sentKeys.every((k) => sameValue((prev as Record<string, unknown>)[k], data[k]))) {
          return { term: prev, duplicate: true as const }
        }
      }
      const count = await tx.pipelinePaymentTerm.count({ where: { dealId } })
      if (count >= MAX_TERMS_PER_DEAL) return { tooMany: true as const }
      if (!data.label) data.label = `Termin ${count + 1}`
      const last = await tx.pipelinePaymentTerm.findFirst({ where: { dealId }, orderBy: { position: "desc" }, select: { position: true } })
      const created = await tx.pipelinePaymentTerm.create({
        data: {
          ...(data as Prisma.PipelinePaymentTermUncheckedCreateInput),
          dealId,
          position: (last?.position ?? 0) + 1024,
          clientRequestId: idem.key,
        },
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
      return { term: created, duplicate: false as const }
    })
    if ("tooMany" in outcome) {
      return NextResponse.json({ error: `Maksimal ${MAX_TERMS_PER_DEAL} termin per deal.`, code: "TOO_MANY_TERMS" }, { status: 400 })
    }
    const { term, duplicate } = outcome

    if (!duplicate) {
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
    }
    const fresh = await prisma.pipelineDeal.findUniqueOrThrow({ where: { id: dealId }, include: dealInclude })
    const today = pipelineToday()
    return NextResponse.json(
      { deal: serializeDeal(fresh, today), term: serializeTerm(term, today), ...(duplicate ? { duplicate: true } : {}) },
      { status: duplicate ? 200 : 201 },
    )
  } catch (error) {
    console.error("Error adding payment term:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
