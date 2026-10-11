export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { scheduleView, validateScheduleInput } from "@/lib/gideon-schedule-api"

async function load(id: string, userId: string) {
  const row = await prisma.gideonSchedule.findUnique({ where: { id } })
  if (!row) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  if (!(await checkProjectAccess(userId, row.projectId, ["LEAD"])).allowed) return { error: NextResponse.json({ error: "Only a project lead can change GIDEON schedules" }, { status: 403 }) }
  return { row }
}

/**
 * Change a schedule. Whoever saves it becomes the person it runs as (createdById): a lead editing a
 * colleague's schedule takes responsibility for what GIDEON reads on it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const r = await load(id, session.user.id)
  if ("error" in r) return r.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const v = validateScheduleInput(body, r.row)
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 })
  const row = await prisma.gideonSchedule.update({ where: { id }, data: { ...v.data, createdById: session.user.id } })
  return NextResponse.json({ schedule: await scheduleView(row) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const r = await load(id, session.user.id)
  if ("error" in r) return r.error
  await prisma.gideonSchedule.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
