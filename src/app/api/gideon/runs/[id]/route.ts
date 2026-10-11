export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { isAdminOrOrgBodPlus } from "@/lib/org"
import { runRowView } from "@/lib/gideon-schedule-api"

/** One run with its steps (tool calls). Who may see it: as GET /api/gideon/runs, plus the person it ran for. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const run = await prisma.gideonRun.findUnique({ where: { id }, include: { steps: { orderBy: { createdAt: "asc" } } } })
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const mine = run.userId === session.user.id
  const allowed = mine || (await isAdminOrOrgBodPlus(session.user.id)) || (run.projectId ? (await checkProjectAccess(session.user.id, run.projectId, ["LEAD"])).allowed : false)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const users = run.userId ? await prisma.user.findMany({ where: { id: run.userId }, select: { id: true, name: true, avatar: true } }) : []
  // Steps of somebody else's chat are hidden like its title: the queries GIDEON ran would retell the question.
  const hideSteps = run.trigger === "CHAT" && !mine
  return NextResponse.json({
    run: runRowView(run, users, session.user.id),
    steps: hideSteps ? [] : run.steps.map((s) => ({ id: s.id, tool: s.tool, label: s.label, ok: s.ok, error: s.error, durationMs: s.durationMs, at: s.createdAt })),
    stepsHidden: hideSteps,
  })
}
