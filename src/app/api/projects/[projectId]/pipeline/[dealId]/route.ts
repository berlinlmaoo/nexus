export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { emitPipelineChanged } from "@/lib/socket-emitter"
import { pipelineToday } from "@/lib/pipeline"
import { syncMainDateTask } from "@/lib/pipeline-execution"
import {
  DEAL_FIELDS,
  costsOf,
  dealInclude,
  historyValue,
  mergeListById,
  normalizeCosts,
  parseDealFields,
  pipelineGate,
  probabilityForStage,
  sameValue,
  serializeDeal,
  servicesOf,
} from "@/lib/pipeline-server"
import { documentHistoryValue, linksForHistory, mergeDocuments, storedDocs } from "@/lib/pipeline-documents"
import type { PipelineCostItem } from "@/lib/pipeline"

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
        // A document's storage key stays on the server (lib/pipeline-documents.ts).
        before: documentHistoryValue(h.field, h.before),
        after: documentHistoryValue(h.field, h.after),
        // A payment-term change ("term.<field>", "term.created" …): which term, named as it was then.
        termId: h.termId,
        termLabel: h.termLabel,
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
 *
 * Race audit 16 Oct 2026, M6: the deal used to be read, compared and written outside any lock, so a
 * document uploaded (or a link list saved) between the read and the write was lost, and two people adding
 * a cost line each kept only the last one. Now the write runs under the deal's row lock (SELECT … FOR
 * UPDATE, the same lock the document upload takes) against the deal as it is at that moment, and the two
 * lists a client sends whole merge three ways when the client says what it started from:
 * `costsBase` / `linksBase` (the list it edited). Without a base — every app before this — a list
 * replaces the stored one as before (stored files always stay: they leave only through DELETE).
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const pre = await findDeal(projectId, dealId)
    if (!pre) return notFound()

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    // Every check (people are looked up here) before the lock; the lists are parsed again under it.
    const checked = await parseDealFields(body, gate.project.workspaceId, pre)
    if (!checked.ok) return NextResponse.json({ ...checked.error, code: "INVALID_FIELD" }, { status: 400 })
    if ("position" in body && (typeof body.position !== "number" || !Number.isFinite(body.position))) {
      return NextResponse.json({ field: "position", error: "Invalid position", code: "INVALID_FIELD" }, { status: 400 })
    }
    const costsBase = Array.isArray(body.costsBase) ? normalizeCosts(body.costsBase) ?? null : null
    const linksBase = Array.isArray(body.linksBase) ? idEntries(body.linksBase) : null

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PipelineDeal" WHERE id = ${dealId} FOR UPDATE`
      const deal = await tx.pipelineDeal.findFirst({ where: { id: dealId, projectId }, include: dealInclude })
      if (!deal) return null
      // Re-parse against the deal as it is now: `links` keeps the files stored NOW, `service` alone keeps
      // the services stored now. People fields need no re-check (their answer doesn't depend on the deal).
      const again = await parseDealFields(withoutPeople(body), gate.project.workspaceId, deal)
      const data: Record<string, unknown> = { ...checked.data, ...(again.ok ? again.data : {}) }
      if (costsBase && Array.isArray(data.costs)) {
        data.costs = mergeListById(costsBase, data.costs as PipelineCostItem[], costsOf(deal.costs), (c) => [c.label, c.amount])
      }
      if (linksBase && "links" in body) {
        const sent = idEntries(body.links)
        const merged = mergeListById(linksBase, sent, storedDocs(deal.links) as unknown as IdEntry[], linkSig)
        const noId = Array.isArray(body.links) ? body.links.filter((l) => !l || typeof l !== "object" || typeof (l as IdEntry).id !== "string") : []
        const links = mergeDocuments(storedDocs(deal.links), [...merged, ...noId])
        if (links) data.links = links
      }

      if (typeof data.stage === "string" && data.stage !== deal.stage && !("probability" in data)) {
        const p = probabilityForStage(data.stage)
        if (p !== null) data.probability = p
      }

      // `services` compared with what the deal shows (an older deal's single service), not the bare column.
      const current = { ...deal, services: servicesOf(deal) } as unknown as Record<string, unknown>
      const changed = Object.keys(data).filter((field) => !sameValue(current[field], data[field]))
      // `service` only mirrors the first of `services`: one history row ("services") says it all.
      const historyFields = changed.filter((field) => field !== "service" || !changed.includes("services"))
      const position = "position" in body && body.position !== deal.position ? (body.position as number) : undefined
      if (changed.length === 0 && position === undefined) return { saved: deal, changed }

      const update: Record<string, unknown> = {}
      for (const field of changed) update[field] = data[field]
      if (position !== undefined) update.position = position
      if (changed.length) update.updatedById = userId

      const saved = await tx.pipelineDeal.update({ where: { id: dealId }, data: update as Prisma.PipelineDealUncheckedUpdateInput, include: dealInclude })
      await tx.pipelineDealChange.createMany({
        data: historyFields.map((field) => ({
          dealId,
          userId,
          field,
          before: (field === "links" ? linksForHistory(current[field]) : historyValue(current[field]) ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (field === "links" ? linksForHistory(data[field]) : historyValue(data[field]) ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      })
      return { saved, changed }
    })
    if (!outcome) return notFound()
    const { saved, changed } = outcome

    // Entering Won makes nothing by itself any more (owner, 10 Oct 2026): the execution folder comes from
    // "Create execution project". A deal that has one keeps its main date on the Master Calendar
    // (lib/pipeline-execution.ts) — after the save, so a failure here never loses the edit.
    let result = saved
    if (changed.includes("mainDate") && (saved.executionCalendarProjectId || saved.executionProjectId)) {
      try {
        await syncMainDateTask(dealId, userId)
        result = (await findDeal(projectId, dealId)) ?? saved
      } catch (error) {
        console.error("Pipeline: main-date task for deal", dealId, "failed:", error)
      }
    }

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
      emitPipelineChanged(projectId, dealId, userId)
    } else if (saved.position !== pre.position) {
      emitPipelineChanged(projectId, dealId, userId)
    }
    return NextResponse.json(serializeDeal(result, pipelineToday()))
  } catch (error) {
    console.error("Error updating pipeline deal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

type IdEntry = { id: string } & Record<string, unknown>

/** The entries of a list that carry an id (what a three-way merge can match). */
function idEntries(raw: unknown): IdEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((l): l is IdEntry => !!l && typeof l === "object" && typeof (l as IdEntry).id === "string" && (l as IdEntry).id.length > 0)
}

/** A document's identity in a merge: its type and name, and the address of a link (a file's address is
 *  the download route in what a client sends and a storage key in what is stored — never compared). */
function linkSig(l: IdEntry): unknown {
  const isFile = l.kind === "file" || "file" in l
  return [l.type ?? null, l.label ?? null, isFile ? null : l.url ?? null]
}

/** The body without the person fields (already checked; the re-parse under the lock needs no lookups). */
function withoutPeople(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) if (DEAL_FIELDS[k]?.kind !== "user") out[k] = v
  return out
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
