export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { emitPipelineChanged } from "@/lib/socket-emitter"
import { pipelineToday } from "@/lib/pipeline"
import { canHaveExecutionProject, ensureExecutionProject } from "@/lib/pipeline-execution"
import { dealInclude, pipelineGate, serializeDeal } from "@/lib/pipeline-server"

type Ctx = { params: Promise<{ projectId: string; dealId: string }> }

/**
 * "Create execution project" on a won deal (owner/GM, 9 Oct 2026). A stage move into Won makes it by
 * itself; this is for a deal that has none — the GM's imported deals, which came in already won, or one
 * whose project was deleted. Idempotent: a deal that has one gets that one back (201 only when made now).
 * → { projectId, created, deal }
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, dealId } = await params
    const gate = await pipelineGate(userId, projectId, "write")
    if (!gate.ok) return gate.response
    const deal = await prisma.pipelineDeal.findFirst({ where: { id: dealId, projectId }, select: { stage: true, executionProjectId: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
    if (!deal.executionProjectId && !canHaveExecutionProject(deal.stage)) {
      return NextResponse.json({ error: "Deal ini belum won.", code: "NOT_WON" }, { status: 400 })
    }

    const result = await ensureExecutionProject(dealId, userId, { auto: false, request })
    if (!result) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
    const saved = await prisma.pipelineDeal.findUniqueOrThrow({ where: { id: dealId }, include: dealInclude })
    if (result.created) emitPipelineChanged(projectId, dealId, userId)
    return NextResponse.json(
      { projectId: result.projectId, created: result.created, deal: serializeDeal(saved, pipelineToday()) },
      { status: result.created ? 201 : 200 },
    )
  } catch (error) {
    console.error("Error creating execution project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
