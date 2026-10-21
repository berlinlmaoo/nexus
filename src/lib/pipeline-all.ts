import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hasProjectWideAccess } from "@/lib/rbac"
import { PIPELINE_VOCAB, dealYearsOf, filterByYear, pipelineToday, summarize } from "@/lib/pipeline"
export { parseYearParam } from "@/lib/pipeline"
import { dealInclude, serializeDeal, type SerializedDeal } from "@/lib/pipeline-server"

/**
 * "All Pipelines" (owner, 21 Oct 2026; Control Tower v8 "Source", NEXUS's own design): every company has its
 * own Pipeline board (Z Networks, Suwara, Intoo, PATS …), isolated by the normal per-project access. On top of
 * them BoD and One Above All — and nobody else — get one combined view of every Pipeline board of the
 * workspace: "Source" is the board's name. Enforced HERE, on every request (403 for Manager / Staff even when
 * they are members of every board), never only by hiding a button. Read-only: deals are created and edited
 * inside their own board.
 */

export type PipelineBoardRef = { id: string; name: string; icon: string; color: string; status: string; dealCount: number }

export type AllPipelinesGate =
  | { ok: true; workspaceId: string; role: string; boards: PipelineBoardRef[] }
  | { ok: false; response: NextResponse }

const forbidden = () =>
  NextResponse.json({ error: "All Pipelines is for BoD and One Above All only.", code: "ALL_PIPELINES_FORBIDDEN" }, { status: 403 })

/**
 * Who may open All Pipelines, and which boards it holds. `workspaceId` (optional): the workspace to read; without
 * it, the first workspace (oldest membership) where the viewer is BoD / One Above All. Not BoD / OAA there → 403.
 */
export async function allPipelinesGate(userId: string, workspaceId: string | null): Promise<AllPipelinesGate> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, ...(workspaceId ? { workspaceId } : {}) },
    select: { workspaceId: true, role: true },
    orderBy: { joinedAt: "asc" },
  })
  const m = memberships.find((x) => hasProjectWideAccess(x.role))
  if (!m) return { ok: false, response: forbidden() }
  const projects = await prisma.project.findMany({
    where: { workspaceId: m.workspaceId, type: "PIPELINE" },
    select: { id: true, name: true, icon: true, color: true, status: true, _count: { select: { pipelineDeals: true } } },
    orderBy: [{ name: "asc" }],
  })
  return {
    ok: true,
    workspaceId: m.workspaceId,
    role: m.role,
    boards: projects.map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color, status: p.status, dealCount: p._count.pipelineDeals })),
  }
}

/** A deal of All Pipelines: the board's deal as always, plus where it comes from. */
export type SourcedDeal = SerializedDeal & { source: { projectId: string; name: string } }

/**
 * The combined deals of the gate's boards, filtered by `source` (one board id, or null = all) and `year`
 * (null = every year; a year = only deals whose event date falls in it). Ordered by board name, then as on the
 * board (stage position).
 */
export async function loadAllPipelines(
  gate: Extract<AllPipelinesGate, { ok: true }>,
  opts: { source: string | null; year: number | null; orderByCode?: boolean },
) {
  const today = pipelineToday()
  const ids = gate.boards.map((b) => b.id).filter((id) => !opts.source || id === opts.source)
  const rows = ids.length
    ? await prisma.pipelineDeal.findMany({
        where: { projectId: { in: ids } },
        include: dealInclude,
        orderBy: opts.orderByCode ? [{ code: "asc" }] : [{ position: "asc" }, { createdAt: "asc" }],
      })
    : []
  const names = new Map(gate.boards.map((b) => [b.id, b.name]))
  const all: SourcedDeal[] = rows.map((row) => ({ ...serializeDeal(row, today), source: { projectId: row.projectId, name: names.get(row.projectId) ?? "" } }))
  const deals = filterByYear(all, opts.year)
  return { today, all, deals, years: dealYearsOf(all), summary: summarize(deals, today), vocab: PIPELINE_VOCAB }
}
