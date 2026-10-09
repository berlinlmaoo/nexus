export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { emitPipelineChanged } from "@/lib/socket-emitter"
import { pipelineToday } from "@/lib/pipeline"
import {
  dealInclude,
  historyValue,
  parseTermFields,
  pipelineGate,
  sameValue,
  serializeDeal,
  serializeTerm,
} from "@/lib/pipeline-server"

type Ctx = { params: Promise<{ projectId: string; dealId: string; termId: string }> }

async function findTerm(projectId: string, dealId: string, termId: string) {
  return prisma.pipelinePaymentTerm.findFirst({
    where: { id: termId, dealId, deal: { projectId } },
    include: { deal: { select: { code: true } } },
  })
}

const notFound = () => NextResponse.json({ error: "Term not found" }, { status: 404 })

/**
 * Edit a payment term (owner, 9 Oct 2026): only the fields sent change, each one that changed writes a
 * history row on the deal ("term.<field>", with the term's id and label). "Mark paid" is a PATCH of
 * paidAmount + paidAt; a payment without a date is dated today (WIB). `position` reorders, no history.
 * → { deal, term }.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId, termId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const term = await findTerm(projectId, dealId, termId)
    if (!term) return notFound()

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const parsed = parseTermFields(body)
    if (!parsed.ok) return NextResponse.json({ ...parsed.error, code: "INVALID_FIELD" }, { status: 400 })
    const data = parsed.data
    // A blank label would leave the term nameless in the list and the history: keep the old one.
    if ("label" in data && !data.label) delete data.label
    if ((data.paidAmount as number | undefined) && !("paidAt" in data) && !term.paidAt) {
      data.paidAt = new Date(`${pipelineToday()}T00:00:00.000Z`)
    }

    const current = term as unknown as Record<string, unknown>
    const changed = Object.keys(data).filter((field) => !sameValue(current[field], data[field]))
    let position: number | undefined
    if ("position" in body) {
      if (typeof body.position !== "number" || !Number.isFinite(body.position)) {
        return NextResponse.json({ field: "position", error: "Invalid position", code: "INVALID_FIELD" }, { status: 400 })
      }
      if (body.position !== term.position) position = body.position
    }

    let saved = term
    if (changed.length || position !== undefined) {
      const update: Record<string, unknown> = {}
      for (const field of changed) update[field] = data[field]
      if (position !== undefined) update.position = position
      saved = await prisma.$transaction(async (tx) => {
        const row = await tx.pipelinePaymentTerm.update({
          where: { id: termId },
          data: update as Prisma.PipelinePaymentTermUncheckedUpdateInput,
          include: { deal: { select: { code: true } } },
        })
        if (changed.length) {
          await tx.pipelineDealChange.createMany({
            data: changed.map((field) => ({
              dealId,
              userId,
              field: `term.${field}`,
              termId,
              // The label it has now, so a rename reads "Termin 1 → DP" under the new name.
              termLabel: row.label,
              before: (historyValue(current[field]) ?? undefined) as Prisma.InputJsonValue | undefined,
              after: (historyValue(data[field]) ?? undefined) as Prisma.InputJsonValue | undefined,
            })),
          })
          await tx.pipelineDeal.update({ where: { id: dealId }, data: { updatedById: userId } })
        }
        return row
      })
      if (changed.length) {
        logAudit({
          action: "update",
          entityType: "pipeline_term",
          entityId: termId,
          entityName: `${saved.deal.code} · ${saved.label}`,
          userId,
          request,
          metadata: { projectId, dealId, fields: changed },
        })
      }
      emitPipelineChanged(projectId, dealId, userId)
    }

    const fresh = await prisma.pipelineDeal.findUniqueOrThrow({ where: { id: dealId }, include: dealInclude })
    const today = pipelineToday()
    return NextResponse.json({ deal: serializeDeal(fresh, today), term: serializeTerm(saved, today) })
  } catch (error) {
    console.error("Error updating payment term:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Delete a term, restorable from Control Room → Audit like every delete (entityType "pipeline_term";
 * the deal's history keeps a "term.deleted" row with what it was). → { deal }.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId, termId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const term = await findTerm(projectId, dealId, termId)
    if (!term) return notFound()

    await restorableDelete({
      entityType: "pipeline_term",
      entityId: termId,
      entityName: `${term.deal.code} · ${term.label}`,
      workspaceId: gate.project.workspaceId,
      userId,
      request,
      metadata: { projectId, dealId, amount: term.amount, paidAmount: term.paidAmount },
      meta: { open: { type: "pipeline_deal", id: dealId, projectId }, projectId },
      remove: async (tx) => {
        await tx.pipelinePaymentTerm.delete({ where: { id: termId } })
        await tx.pipelineDealChange.create({
          data: {
            dealId,
            userId,
            field: "term.deleted",
            termId,
            termLabel: term.label,
            before: {
              amount: term.amount,
              dueDate: historyValue(term.dueDate),
              paidAmount: term.paidAmount,
            } as Prisma.InputJsonValue,
          },
        })
        await tx.pipelineDeal.update({ where: { id: dealId }, data: { updatedById: userId } })
      },
    })
    emitPipelineChanged(projectId, dealId, userId)
    const fresh = await prisma.pipelineDeal.findUniqueOrThrow({ where: { id: dealId }, include: dealInclude })
    return NextResponse.json({ deal: serializeDeal(fresh, pipelineToday()) })
  } catch (error) {
    console.error("Error deleting payment term:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
