export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { runScheduledDigest } from "@/lib/gideon-triggers"

/**
 * "Run now": one digest immediately (a lead checking what the weekly post will look like). Takes up to a
 * couple of minutes, so it answers 202 at once and the result shows up in the project's status updates
 * and in the run log. At most one manual run per schedule every 10 minutes (it costs real model credits).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const row = await prisma.gideonSchedule.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!(await checkProjectAccess(session.user.id, row.projectId, ["LEAD"])).allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!process.env.GIDEON_CHAT_URL) return NextResponse.json({ error: "GIDEON is not connected on this server" }, { status: 503 })
  const recent = await prisma.gideonRun.findFirst({ where: { scheduleId: id, startedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } }, select: { id: true } })
  if (recent) return NextResponse.json({ error: "It ran less than 10 minutes ago. Wait a little." }, { status: 429 })
  void runScheduledDigest(id, { manual: true })
  return NextResponse.json({ started: true }, { status: 202 })
}
