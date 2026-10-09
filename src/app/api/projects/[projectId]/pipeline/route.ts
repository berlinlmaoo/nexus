export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { emitPipelineChanged } from "@/lib/socket-emitter"
import { PIPELINE_VOCAB, pipelineToday, summarize } from "@/lib/pipeline"
import { EXECUTION_TRIGGER_STAGES, ensureExecutionProject } from "@/lib/pipeline-execution"
import {
  dealInclude,
  defaultProbability,
  nextDealCode,
  parseDealFields,
  pipelineGate,
  serializeDeal,
} from "@/lib/pipeline-server"

/**
 * The deals of a Pipeline Dashboard project (owner, 9 Oct 2026) — the GM's "Control Tower" board, in
 * NEXUS. GET: every deal with its derived health and phases, the KPI summary over all of them, and the
 * option lists. POST: a new deal. Spec: ~/handoff/chat/PIPELINE-DASHBOARD.md.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const gate = await pipelineGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response

    const rows = await prisma.pipelineDeal.findMany({
      where: { projectId },
      include: dealInclude,
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    })
    const today = pipelineToday()
    const deals = rows.map((row) => serializeDeal(row, today))
    return NextResponse.json({
      project: gate.project,
      deals,
      summary: summarize(deals, today),
      vocab: PIPELINE_VOCAB,
      today,
    })
  } catch (error) {
    console.error("Error loading pipeline:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    // A blank name gets the default instead of a 400: "New deal" from a column's "+" is the usual start.
    if (typeof body.name !== "string" || !body.name.trim()) body.name = "New deal"
    const parsed = await parseDealFields(body, gate.project.workspaceId)
    if (!parsed.ok) return NextResponse.json({ ...parsed.error, code: "INVALID_FIELD" }, { status: 400 })

    const stage = (parsed.data.stage as string | undefined) ?? "Incoming"
    const last = await prisma.pipelineDeal.findFirst({
      where: { projectId, stage },
      orderBy: { position: "desc" },
      select: { position: true },
    })

    // Two people adding a deal in the same second can pick the same code; the unique index refuses
    // the second, which then takes the next one.
    let created = null
    for (let attempt = 0; attempt < 4 && !created; attempt++) {
      const code = await nextDealCode(projectId)
      try {
        created = await prisma.pipelineDeal.create({
          data: {
            probability: defaultProbability(stage),
            ...parsed.data,
            name: parsed.data.name as string,
            stage,
            code,
            position: (last?.position ?? 0) + 1024,
            projectId,
            createdById: userId,
            updatedById: userId,
          },
          include: dealInclude,
        })
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
      }
    }
    if (!created) return NextResponse.json({ error: "Could not number the deal. Try again." }, { status: 409 })

    // Awaited: the code sequence reads these rows (nextDealCode), so it must exist before the next create.
    await logAudit({
      action: "create",
      entityType: "pipeline_deal",
      entityId: created.id,
      entityName: `${created.code} ${created.name}`,
      userId,
      request,
      metadata: { projectId, code: created.code, stage },
    })
    // Added straight into a Won column: won from the start, so it gets its execution project too.
    let result = created
    if ((EXECUTION_TRIGGER_STAGES as readonly string[]).includes(stage)) {
      try {
        await ensureExecutionProject(created.id, userId, { auto: true, request })
        result = (await prisma.pipelineDeal.findUnique({ where: { id: created.id }, include: dealInclude })) ?? created
      } catch (error) {
        console.error("Pipeline: execution project for new deal", created.id, "failed:", error)
      }
    }
    emitPipelineChanged(projectId, created.id, userId)
    return NextResponse.json(serializeDeal(result, pipelineToday()), { status: 201 })
  } catch (error) {
    console.error("Error creating pipeline deal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
