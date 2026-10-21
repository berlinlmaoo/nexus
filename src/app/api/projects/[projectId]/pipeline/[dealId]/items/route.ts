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
  MAX_ITEMS_PER_KIND,
  dealInclude,
  isItemKind,
  itemLabel,
  parseItemFields,
  pipelineGate,
  sameValue,
  serializeDeal,
  serializeItem,
} from "@/lib/pipeline-server"

type Ctx = { params: Promise<{ projectId: string; dealId: string }> }

/**
 * Add a cashback recipient, a project contact or a budget category to a deal (Control Tower v8, 21 Oct 2026).
 * Body: { kind: "cashback" | "contact" | "budget", …fields, clientRequestId? } — cashback / budget: name, amount;
 * contact: role (CONTACT_ROLES, default "Client"), name, phone. Same access as editing the deal (Full / Can edit).
 * → 201 { deal, item } (the whole deal: its totals and budget remaining moved).
 *
 * Race-safe like "Add term" (race audit 16 Oct 2026, M7): count, position and the duplicate check run under the
 * deal's row lock; `clientRequestId` (or the Idempotency-Key header) stores one row per key and a repeat answers
 * 200 { deal, item, duplicate: true }; without a key the very same item added by the same person in the last
 * 10 s is taken as a double tap.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const deal = await prisma.pipelineDeal.findFirst({ where: { id: dealId, projectId }, select: { id: true, code: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const kind = body.kind
    if (!isItemKind(kind)) return NextResponse.json({ field: "kind", error: "kind harus cashback, contact atau budget.", code: "INVALID_FIELD" }, { status: 400 })
    const idem = readIdempotencyKey(request, body.clientRequestId)
    if (!idem.ok) return idem.response
    const parsed = parseItemFields(kind, body)
    if (!parsed.ok) return NextResponse.json({ ...parsed.error, code: "INVALID_FIELD" }, { status: 400 })
    const data = parsed.data
    if (kind === "contact" && !data.role) data.role = "Client"
    const sentKeys = Object.keys(data)
    const createdField = `${kind}.created`

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PipelineDeal" WHERE id = ${dealId} FOR UPDATE`
      if (idem.key) {
        const seen = await tx.pipelineDealItem.findFirst({ where: { dealId, clientRequestId: idem.key } })
        if (seen) return { item: seen, duplicate: true as const }
      } else {
        const recent = await tx.pipelineDealChange.findFirst({
          where: { dealId, userId, field: createdField, createdAt: { gte: new Date(Date.now() - DOUBLE_TAP_MS) } },
          orderBy: { createdAt: "desc" },
          select: { termId: true },
        })
        const prev = recent?.termId ? await tx.pipelineDealItem.findUnique({ where: { id: recent.termId } }) : null
        if (prev && !prev.clientRequestId && sentKeys.every((k) => sameValue((prev as Record<string, unknown>)[k], data[k]))) {
          return { item: prev, duplicate: true as const }
        }
      }
      const count = await tx.pipelineDealItem.count({ where: { dealId, kind } })
      if (count >= MAX_ITEMS_PER_KIND) return { tooMany: true as const }
      const last = await tx.pipelineDealItem.findFirst({ where: { dealId, kind }, orderBy: { position: "desc" }, select: { position: true } })
      const created = await tx.pipelineDealItem.create({
        data: {
          ...(data as Prisma.PipelineDealItemUncheckedCreateInput),
          kind,
          dealId,
          position: (last?.position ?? 0) + 1024,
          clientRequestId: idem.key,
        },
      })
      // One history row for the new item (termId / termLabel carry the item's id and name).
      await tx.pipelineDealChange.create({
        data: {
          dealId,
          userId,
          field: createdField,
          termId: created.id,
          termLabel: itemLabel(created),
          after: { name: created.name, amount: created.amount, role: created.role, phone: created.phone } as Prisma.InputJsonValue,
        },
      })
      await tx.pipelineDeal.update({ where: { id: dealId }, data: { updatedById: userId } })
      return { item: created, duplicate: false as const }
    })
    if ("tooMany" in outcome) {
      return NextResponse.json({ error: `Maksimal ${MAX_ITEMS_PER_KIND} baris per daftar.`, code: "TOO_MANY_ITEMS" }, { status: 400 })
    }
    const { item, duplicate } = outcome
    if (!duplicate) {
      logAudit({
        action: "create",
        entityType: "pipeline_item",
        entityId: item.id,
        entityName: `${deal.code} · ${itemLabel(item)}`,
        userId,
        request,
        metadata: { projectId, dealId, kind, amount: item.amount },
      })
      emitPipelineChanged(projectId, dealId, userId)
    }
    const fresh = await prisma.pipelineDeal.findUniqueOrThrow({ where: { id: dealId }, include: dealInclude })
    return NextResponse.json(
      { deal: serializeDeal(fresh, pipelineToday()), item: serializeItem(item), ...(duplicate ? { duplicate: true } : {}) },
      { status: duplicate ? 200 : 201 },
    )
  } catch (error) {
    console.error("Error adding pipeline item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
