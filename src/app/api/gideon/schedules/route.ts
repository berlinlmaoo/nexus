export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { scheduleView, validateScheduleInput } from "@/lib/gideon-schedule-api"

/**
 * GIDEON schedules of one project (12 Oct 2026). GET: anyone who can see the project. POST: a project
 * lead (or above) — the digest runs as the person who sets it up, so it reads exactly what they can.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const projectId = req.nextUrl.searchParams.get("projectId") || ""
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
  if (!(await checkProjectAccess(session.user.id, projectId, ["VIEWER"])).allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const canManage = (await checkProjectAccess(session.user.id, projectId, ["LEAD"])).allowed
  const rows = await prisma.gideonSchedule.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } })
  return NextResponse.json({ schedules: await Promise.all(rows.map(scheduleView)), canManage, configured: Boolean(process.env.GIDEON_CHAT_URL) })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const projectId = typeof body.projectId === "string" ? body.projectId : ""
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
  if (!(await checkProjectAccess(session.user.id, projectId, ["LEAD"])).allowed) return NextResponse.json({ error: "Only someone with Full access to the project (its Project Owner or the BoD) can set up GIDEON schedules" }, { status: 403 })
  const count = await prisma.gideonSchedule.count({ where: { projectId } })
  if (count >= 3) return NextResponse.json({ error: "A project can have at most 3 GIDEON schedules" }, { status: 400 })
  const v = validateScheduleInput(body, null)
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 })
  const row = await prisma.gideonSchedule.create({ data: { projectId, createdById: session.user.id, ...v.data } })
  return NextResponse.json({ schedule: await scheduleView(row) }, { status: 201 })
}
