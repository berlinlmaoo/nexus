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
  parseDealFields,
  pipelineGate,
  probabilityForStage,
  sameValue,
  serializeDeal,
} from "@/lib/pipeline-server"

type Ctx = { params: Promise<{ projectId: string; dealId: string }> }

/** How much history one read returns, newest first. */
const HISTORY_LIMIT = 200

async function findDeal(projectId: string, dealId: string) {
  return prisma.pipelineDeal.findFirst({ where: { id: dealId, projectId }, include: dealInclude })
}

const notFound = () => NextResponse.json({ error: "Deal not found" }, { status: 404 })

/** One deal and its edit history: who changed which field from what to what (owner, 9 Oct 2026). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId, dealId } = await params
    const gate = await pipelineGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const deal = await findDeal(projectId, dealId)
    if (!deal) return notFound()
    const history = await prisma.pipelineDealChange.findMany({
      where: { dealId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_LIMIT,
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })
    return NextResponse.json({
      deal: serializeDeal(deal, pipelineToday()),
      history: history.map((h) => ({
        id: h.id,
        field: h.field,
        before: h.before,
        after: h.after,
        createdAt: h.createdAt.toISOString(),
        user: h.user,
      })),
    })
  } catch (error) {
    console.error("Error loading pipeline deal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Change some fields. Only what is sent changes, and each field that actually changed writes one history
 * row — so two people editing different fields of the same deal never undo each other. `position` (the
 * order inside a column, from a drag) is accepted but is not history.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const deal = await findDeal(projectId, dealId)
    if (!deal) return notFound()

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const parsed = await parseDealFields(body, gate.project.workspaceId)
    if (!parsed.ok) return NextResponse.json({ ...parsed.error, code: "INVALID_FIELD" }, { status: 400 })
    const data = parsed.data

    if (typeof data.stage === "string" && data.stage !== deal.stage && !("probability" in data)) {
      const p = probabilityForStage(data.stage)
      if (p !== null) data.probability = p
    }

    const current = deal as unknown as Record<string, unknown>
    const changed = Object.keys(data).filter((field) => !sameValue(current[field], data[field]))
    let position: number | undefined
    if ("position" in body) {
      if (typeof body.position !== "number" || !Number.isFinite(body.position)) {
        return NextResponse.json({ field: "position", error: "Invalid position", code: "INVALID_FIELD" }, { status: 400 })
      }
      if (body.position !== deal.position) position = body.position
    }
    if (changed.length === 0 && position === undefined) {
      return NextResponse.json(serializeDeal(deal, pipelineToday()))
    }

    const update: Record<string, unknown> = {}
    for (const field of changed) update[field] = data[field]
    if (position !== undefined) update.position = position
    if (changed.length) update.updatedById = userId

    const [saved] = await prisma.$transaction([
      prisma.pipelineDeal.update({ where: { id: dealId }, data: update as Prisma.PipelineDealUncheckedUpdateInput, include: dealInclude }),
      prisma.pipelineDealChange.createMany({
        data: changed.map((field) => ({
          dealId,
          userId,
          field,
          before: (historyValue(current[field]) ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (historyValue(data[field]) ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      }),
    ])

    if (changed.length) {
      logAudit({
        action: "update",
        entityType: "pipeline_deal",
        entityId: dealId,
        entityName: `${saved.code} ${saved.name}`,
        userId,
        request,
        metadata: { projectId, fields: changed },
      })
    }
    emitPipelineChanged(projectId, dealId, userId)
    return NextResponse.json(serializeDeal(saved, pipelineToday()))
  } catch (error) {
    console.error("Error updating pipeline deal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Delete, restorable from Control Room → Audit with its history (lib/deletion-snapshot.ts). */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const deal = await prisma.pipelineDeal.findFirst({ where: { id: dealId, projectId }, select: { code: true, name: true, stage: true, netValue: true } })
    if (!deal) return notFound()

    await restorableDelete({
      entityType: "pipeline_deal",
      entityId: dealId,
      entityName: `${deal.code} ${deal.name}`,
      workspaceId: gate.project.workspaceId,
      userId,
      request,
      metadata: { projectId, code: deal.code, stage: deal.stage, netValue: deal.netValue },
      meta: { open: { type: "pipeline_deal", id: dealId, projectId }, projectId },
      remove: (tx) => tx.pipelineDeal.delete({ where: { id: dealId } }),
    })
    emitPipelineChanged(projectId, dealId, userId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting pipeline deal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
