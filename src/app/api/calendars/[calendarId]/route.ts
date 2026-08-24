export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { ROOM_BOOKING_ROOMS } from "@/lib/validations"
import { isSystemAdminUser } from "@/lib/rbac"

const MANAGER_ROLES: readonly string[] = ["BOD", "MANAGER", "ONE_ABOVE_ALL"]
async function canManageCalendars(userId: string, workspaceId: string) {
  if (await isSystemAdminUser(userId)) return true
  const m = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  })
  return !!m && MANAGER_ROLES.includes(m.role)
}

const calendarSelect = {
  id: true,
  name: true,
  color: true,
  projectIds: true,
  roomSources: true,
  position: true,
  workspaceId: true,
  createdById: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ calendarId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { calendarId } = await params

    const existing = await prisma.calendar.findUnique({ where: { id: calendarId }, select: { id: true, workspaceId: true } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canManageCalendars(userId, existing.workspaceId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const data: { name?: string; color?: string | null; projectIds?: string[]; roomSources?: string[]; position?: number } = {}
    if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim()
    if (body?.color === null || typeof body?.color === "string") data.color = body.color || null
    if (Array.isArray(body?.projectIds)) data.projectIds = body.projectIds.filter((x: unknown) => typeof x === "string") as string[]
    // Canonical room names only — same guard as POST, so an unknown room can't be persisted.
    if (Array.isArray(body?.roomSources)) data.roomSources = body.roomSources.filter((x: unknown): x is string => typeof x === "string" && (ROOM_BOOKING_ROOMS as readonly string[]).includes(x))
    if (Number.isInteger(body?.position)) data.position = body.position

    const calendar = await prisma.calendar.update({ where: { id: calendarId }, data, select: calendarSelect })
    return NextResponse.json({ calendar })
  } catch (error) {
    console.error("Error updating calendar:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ calendarId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { calendarId } = await params

    const existing = await prisma.calendar.findUnique({ where: { id: calendarId }, select: { id: true, workspaceId: true } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canManageCalendars(userId, existing.workspaceId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    await prisma.calendar.delete({ where: { id: calendarId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting calendar:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
