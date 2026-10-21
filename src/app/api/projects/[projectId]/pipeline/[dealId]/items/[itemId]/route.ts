export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { isRecordNotFound } from "@/lib/prisma-errors"
import { emitPipelineChanged } from "@/lib/socket-emitter"
import { pipelineToday } from "@/lib/pipeline"
import {
  dealInclude,
  historyValue,
  isItemKind,
  itemLabel,
  parseItemFields,
  pipelineGate,
  sameValue,
  serializeDeal,
  serializeItem,
} from "@/lib/pipeline-server"

type Ctx = { params: Promise<{ projectId: string; dealId: string; itemId: string }> }

const notFound = () => NextResponse.json({ error: "Item not found" }, { status: 404 })

/**
 * Edit one cashback recipient / contact / budget category (Control Tower v8, 21 Oct 2026). Only the fields sent
 * change (kind cannot); each one that changed writes a history row "<kind>.<field>" on the deal. The write runs
 * under the deal's row lock against the item as it is then, so two people editing different fields of the same
 * item both keep their change. `position` reorders, no history. → { deal, item }.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId, itemId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const pre = await prisma.pipelineDealItem.findFirst({ where: { id: itemId, dealId, deal: { projectId } }, select: { kind: true } })
    if (!pre || !isItemKind(pre.kind)) return notFound()

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const parsed = parseItemFields(pre.kind, body)
    if (!parsed.ok) return NextResponse.json({ ...parsed.error, code: "INVALID_FIELD" }, { status: 400 })
    const data = parsed.data
    let position: number | undefined
    if ("position" in body) {
      if (typeof body.position !== "number" || !Number.isFinite(body.position)) {
        return NextResponse.json({ field: "position", error: "Invalid position", code: "INVALID_FIELD" }, { status: 400 })
      }
      position = body.position
    }

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PipelineDeal" WHERE id = ${dealId} FOR UPDATE`
      const item = await tx.pipelineDealItem.findFirst({ where: { id: itemId, dealId } })
      if (!item) return null
      const current = item as unknown as Record<string, unknown>
      const changed = Object.keys(data).filter((field) => !sameValue(current[field], data[field]))
      const move = position !== undefined && position !== item.position
      if (!changed.length && !move) return { item, changed }
      const update: Record<string, unknown> = {}
      for (const field of changed) update[field] = data[field]
      if (move) update.position = position
      const row = await tx.pipelineDealItem.update({ where: { id: itemId }, data: update as Prisma.PipelineDealItemUncheckedUpdateInput })
      if (changed.length) {
        await tx.pipelineDealChange.createMany({
          data: changed.map((field) => ({
            dealId,
            userId,
            field: `${item.kind}.${field}`,
            termId: itemId,
            termLabel: itemLabel(row),
            before: (historyValue(current[field]) ?? undefined) as Prisma.InputJsonValue | undefined,
            after: (historyValue(data[field]) ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        })
        await tx.pipelineDeal.update({ where: { id: dealId }, data: { updatedById: userId } })
      }
      return { item: row, changed }
    })
    if (!outcome) return notFound()
    const { item, changed } = outcome
    if (changed.length) {
      const deal = await prisma.pipelineDeal.findUnique({ where: { id: dealId }, select: { code: true } })
      logAudit({
        action: "update",
        entityType: "pipeline_item",
        entityId: itemId,
        entityName: `${deal?.code ?? ""} · ${itemLabel(item)}`,
        userId,
        request,
        metadata: { projectId, dealId, kind: item.kind, fields: changed },
      })
    }
    if (changed.length || position !== undefined) emitPipelineChanged(projectId, dealId, userId)
    const fresh = await prisma.pipelineDeal.findUniqueOrThrow({ where: { id: dealId }, include: dealInclude })
    return NextResponse.json({ deal: serializeDeal(fresh, pipelineToday()), item: serializeItem(item) })
  } catch (error) {
    console.error("Error updating pipeline item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Delete one item, restorable from Control Room → Audit like every delete (entityType "pipeline_item"); the
 * deal's history keeps a "<kind>.deleted" row with what it was. Cost lines booked against a deleted budget
 * category keep its id, so restoring the category books them back. → { deal }.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId, itemId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const item = await prisma.pipelineDealItem.findFirst({
      where: { id: itemId, dealId, deal: { projectId } },
      include: { deal: { select: { code: true } } },
    })
    if (!item) return notFound()

    await restorableDelete({
      entityType: "pipeline_item",
      entityId: itemId,
      entityName: `${item.deal.code} · ${itemLabel(item)}`,
      workspaceId: gate.project.workspaceId,
      userId,
      request,
      metadata: { projectId, dealId, kind: item.kind, amount: item.amount },
      meta: { open: { type: "pipeline_deal", id: dealId, projectId }, projectId },
      remove: async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PipelineDeal" WHERE id = ${dealId} FOR UPDATE`
        await tx.pipelineDealItem.delete({ where: { id: itemId } })
        await tx.pipelineDealChange.create({
          data: {
            dealId,
            userId,
            field: `${item.kind}.deleted`,
            termId: itemId,
            termLabel: itemLabel(item),
            before: { name: item.name, amount: item.amount, role: item.role, phone: item.phone } as Prisma.InputJsonValue,
          },
        })
        await tx.pipelineDeal.update({ where: { id: dealId }, data: { updatedById: userId } })
      },
    })
    emitPipelineChanged(projectId, dealId, userId)
    const fresh = await prisma.pipelineDeal.findUniqueOrThrow({ where: { id: dealId }, include: dealInclude })
    return NextResponse.json({ deal: serializeDeal(fresh, pipelineToday()) })
  } catch (error) {
    // Two people deleting the same item at once: the second finds it gone.
    if (isRecordNotFound(error)) return notFound()
    console.error("Error deleting pipeline item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
