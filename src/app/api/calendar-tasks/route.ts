export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { isSystemAdminUser } from "@/lib/rbac"
import { ROOM_BOOKING_ROOMS } from "@/lib/validations"
import { getUserWorkspaceIds } from "@/lib/workspace-scope"

const ADMIN_ROLES: readonly string[] = ["BOD", "MANAGER", "ONE_ABOVE_ALL"]

// Task feed for a project-sourced calendar. Returns tasks (with a due/start date in range) from the
// requested projects — BUT only those the viewer is actually allowed to see. Project access mirrors
// /api/projects: BoD/Manager see all projects in their workspace; staff see only projects they're a
// member of; system admins see all. This prevents a shared calendar from leaking tasks of projects
// the viewer can't access (anti-IDOR per the security canon).
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const sp = request.nextUrl.searchParams
    const rawIds = (sp.get("projectIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    const projectIds = Array.from(new Set(rawIds)).slice(0, 200)
    // Room Booking sources ride along in the same request so the calendar needs one round-trip.
    // Unknown names are dropped — the response must never depend on an arbitrary caller string.
    const rooms = Array.from(new Set((sp.get("rooms") ?? "").split(",").map((s) => s.trim()).filter(Boolean)))
      .filter((r) => (ROOM_BOOKING_ROOMS as readonly string[]).includes(r))
    const rangeStart = sp.get("rangeStart")
    const rangeEnd = sp.get("rangeEnd")

    const empty = { tasks: [], bookings: [] }
    if ((projectIds.length === 0 && rooms.length === 0) || !rangeStart || !rangeEnd) return NextResponse.json(empty)
    const start = new Date(rangeStart)
    const end = new Date(rangeEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return NextResponse.json(empty)

    const isAdmin = await isSystemAdminUser(userId)

    // Compute access filter in JS (workspace ids where viewer is admin) instead of an enum `in` filter.
    const projectWhere: Record<string, unknown> = { id: { in: projectIds } }
    if (!isAdmin) {
      const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true, role: true } })
      const adminWorkspaceIds = memberships.filter((m) => ADMIN_ROLES.includes(m.role)).map((m) => m.workspaceId)
      projectWhere.OR = [
        { workspaceId: { in: adminWorkspaceIds.length ? adminWorkspaceIds : ["__none__"] } },
        { members: { some: { userId } } },
      ]
    }

    // Outer where typed as Record so nested filters check against `unknown` (matches the projects route).
    const where: Record<string, unknown> = {
      taskList: { project: projectWhere },
      // Match the frontend's placement rule exactly: a task is plotted on dueDate ?? startDate.
      // So include it iff that placement date falls in range — never fetch a task we'd then hide.
      OR: [
        { dueDate: { gte: start, lte: end } },
        { dueDate: null, startDate: { gte: start, lte: end } },
      ],
    }

    const tasks = projectIds.length === 0 ? [] : await prisma.task.findMany({
      where,
      orderBy: [{ dueDate: "asc" }],
      take: 2000,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        startDate: true,
        taskList: { select: { project: { select: { id: true, name: true, color: true, icon: true } } } },
      },
    })

    const result = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      startDate: t.startDate,
      projectId: t.taskList.project.id,
      projectName: t.taskList.project.name,
      projectColor: t.taskList.project.color,
      projectIcon: t.taskList.project.icon,
    }))

    // Room bookings for the picked rooms. Scope = the viewer's own workspaces (same rule as
    // /api/room-bookings): a booking is workspace-wide info, not project-scoped, so there's no
    // per-project membership to intersect here. Cancelled bookings never reach the calendar.
    const bookings = rooms.length === 0 ? [] : await (async () => {
      const workspaceIds = await getUserWorkspaceIds(userId)
      if (workspaceIds.length === 0) return []
      const rows = await prisma.roomBooking.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          room: { in: rooms },
          status: "ACTIVE",
          startsAt: { gte: start, lte: end },
        },
        orderBy: [{ startsAt: "asc" }],
        take: 2000,
        select: {
          id: true, room: true, title: true, startsAt: true, endsAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      })
      return rows.map((b) => ({
        id: b.id,
        title: b.title,
        room: b.room,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        bookedByName: b.createdBy?.name ?? null,
      }))
    })()

    return NextResponse.json({ tasks: result, bookings })
  } catch (error) {
    console.error("Error fetching calendar tasks:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
