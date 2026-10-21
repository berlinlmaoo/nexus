export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { allPipelinesGate, loadAllPipelines, parseYearParam } from "@/lib/pipeline-all"

/**
 * All Pipelines (owner, 21 Oct 2026): every Pipeline board of the workspace in one read-only view, for BoD and
 * One Above All only (403 ALL_PIPELINES_FORBIDDEN for anyone else, enforced here). Query (all optional):
 *   workspaceId — which workspace (default: the first one where the viewer is BoD / OAA);
 *   source      — one board's project id (the "Source" filter); unknown id → 400;
 *   year        — 4-digit year of the event / main date (cut-off 31 Dec); deals without a date are left out.
 * → { workspaceId, boards, deals (each with source { projectId, name }), summary (same KPIs as a board, over
 *    the filtered deals), years (every year with a deal, newest first), year, source, today, vocab, canEdit: false }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sp = request.nextUrl.searchParams
    const gate = await allPipelinesGate(session.user.id, sp.get("workspaceId"))
    if (!gate.ok) return gate.response
    const year = parseYearParam(sp.get("year"))
    if (year === undefined) return NextResponse.json({ field: "year", error: "year must be YYYY.", code: "INVALID_FIELD" }, { status: 400 })
    const source = sp.get("source") || null
    if (source && !gate.boards.some((b) => b.id === source)) {
      return NextResponse.json({ field: "source", error: "Unknown pipeline board.", code: "INVALID_FIELD" }, { status: 400 })
    }
    const r = await loadAllPipelines(gate, { source, year })
    return NextResponse.json({
      workspaceId: gate.workspaceId,
      boards: gate.boards,
      deals: r.deals,
      summary: r.summary,
      years: r.years,
      year,
      source,
      today: r.today,
      vocab: r.vocab,
      // Read-only: a deal is changed in its own board (open it there).
      canEdit: false,
    })
  } catch (error) {
    console.error("Error loading all pipelines:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
