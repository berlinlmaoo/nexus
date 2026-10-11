export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { cardFromResult, proposalView } from "@/lib/gideon-runs"
import { markAiFill } from "@/lib/gideon-autofill"

/** A proposal older than this is not applied: the task it describes has likely moved on. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * POST /api/gideon/proposals/:id  { decision: "apply" | "discard" }
 *
 * Apply runs the SAME /api/gideon/tools action GIDEON would have run, as the same person (service token
 * + x-gideon-actor), so every access check runs again at the moment of applying — approving a change
 * never grants more than the person has now. The claim PENDING → APPLYING is a conditional update, so a
 * double tap applies once.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { decision?: string }
  const decision = body.decision === "apply" ? "apply" : body.decision === "discard" ? "discard" : null
  if (!decision) return NextResponse.json({ error: "decision must be apply or discard" }, { status: 400 })

  const proposal = await prisma.gideonProposal.findUnique({ where: { id } })
  if (!proposal || proposal.userId !== session.user.id) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (proposal.status !== "PENDING") return NextResponse.json({ error: "Already decided", proposal: proposalView(proposal) }, { status: 409 })

  if (decision === "discard") {
    const updated = await prisma.gideonProposal.update({ where: { id }, data: { status: "DISCARDED", decidedAt: new Date() } })
    return NextResponse.json({ proposal: proposalView(updated) })
  }

  if (Date.now() - proposal.createdAt.getTime() > MAX_AGE_MS) {
    const updated = await prisma.gideonProposal.update({ where: { id }, data: { status: "FAILED", error: "Expired: ask GIDEON again.", decidedAt: new Date() } })
    return NextResponse.json({ error: "Expired", proposal: proposalView(updated) }, { status: 410 })
  }

  const claimed = await prisma.gideonProposal.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPLYING" } })
  if (claimed.count === 0) return NextResponse.json({ error: "Already decided" }, { status: 409 })

  const token = process.env.NEXUS_GIDEON_SERVICE_TOKEN
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } })
  let ok = false
  let data: unknown = null
  let message: string | null = null
  try {
    if (!token) throw new Error("GIDEON is not configured on this server")
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/gideon/tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-gideon-actor": me?.email || session.user.id,
        "x-gideon-approved": id,
      },
      body: JSON.stringify({ action: proposal.action, input: {} }),
      signal: AbortSignal.timeout(30_000),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: string } | null
    ok = Boolean(res.ok && json?.ok)
    data = json?.data ?? null
    message = ok ? null : (typeof json?.error === "string" ? json.error : `Failed (${res.status})`)
  } catch (error) {
    message = error instanceof Error ? error.message : "Failed"
  }

  const card = ok ? cardFromResult(proposal.action, data) : null
  const updated = await prisma.gideonProposal.update({
    where: { id },
    data: ok
      ? { status: "APPLIED", decidedAt: new Date(), result: { card } as object, error: null }
      : { status: "FAILED", decidedAt: new Date(), error: (message || "Failed").slice(0, 500) },
  })
  // An approved AI Autofill value keeps its ✨ marker (CustomFieldAiFill) like one written directly.
  const aiFill = (proposal.input as { aiFill?: Array<{ fieldId?: unknown; value?: unknown }>; taskId?: unknown } | null)
  if (ok && Array.isArray(aiFill?.aiFill) && typeof aiFill?.taskId === "string") {
    for (const f of aiFill.aiFill) if (typeof f.fieldId === "string" && typeof f.value === "string") await markAiFill(f.fieldId, aiFill.taskId, f.value, proposal.runId)
  }
  // No separate audit row: the action itself writes its ActivityLog (GIDEON_TASK_CREATED / _UPDATED /
  // GIDEON_COMMENT_ADDED) exactly as when GIDEON writes without asking.
  return NextResponse.json({ proposal: proposalView(updated) }, { status: ok ? 200 : 422 })
}
