export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { isSystemAdminUser } from "@/lib/rbac"

// Managing calendars (create/edit/delete) mirrors project-folder management: BoD/Manager (+ system
// admin). Viewing is open to any workspace member — enforced in GET by workspace membership.
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
  workspaceId: true,
  createdById: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const isAdmin = await isSystemAdminUser(userId)

    // A calendar is shared across its workspace: list every calendar in a workspace the viewer
    // belongs to (system admins see all). Per-task access is still re-checked in /api/calendar-tasks.
    const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })
    const workspaceIds = memberships.map((m) => m.workspaceId)

    const calendars = await prisma.calendar.findMany({
      where: isAdmin ? {} : { workspaceId: { in: workspaceIds.length ? workspaceIds : ["__none__"] } },
      orderBy: { createdAt: "asc" },
      select: calendarSelect,
    })
    return NextResponse.json({ calendars })
  } catch (error) {
    console.error("Error listing calendars:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : ""
    const color = typeof body?.color === "string" && body.color ? body.color : null
    const projectIds = Array.isArray(body?.projectIds)
      ? (body.projectIds.filter((x: unknown) => typeof x === "string") as string[])
      : []

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 })
    if (!(await canManageCalendars(userId, workspaceId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const calendar = await prisma.calendar.create({
      data: { name, color, projectIds, workspaceId, createdById: userId },
      select: calendarSelect,
    })
    return NextResponse.json({ calendar }, { status: 201 })
  } catch (error) {
    console.error("Error creating calendar:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
