export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { restorableDelete } from "@/lib/deletion-snapshot"

const SECTION_TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]
// A status option's colour (owner, 12 Oct 2026, Notion-style statuses): the web palette's keys
// (lib/project-views.ts COLOR_KEYS). Null = the colour of its group. The first build's names (sky, emerald,
// amber, rose, violet, slate) stay accepted for released apps; the web reads both (normalizeColor). Only
// the old names used to pass here, so blue/green/yellow/red/purple/brown from the web were saved as empty.
const SECTION_COLORS = [
  "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
  "sky", "emerald", "amber", "rose", "violet", "slate",
]
const cleanColor = (v: unknown) => (typeof v === "string" && SECTION_COLORS.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null)

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const sections = await prisma.taskList.findMany({
      where: { projectId: (await params).projectId },
      orderBy: { position: "asc" },
      include: {
        _count: { select: { tasks: true } },
      },
    })

    return NextResponse.json(sections)
  } catch (error) {
    console.error("Error fetching sections:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    const body = await request.json()
    const { name, taskStatus: rawStatus, color } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }
    if (rawStatus !== undefined && rawStatus !== null && !SECTION_TASK_STATUSES.includes(rawStatus)) {
      return NextResponse.json({ error: "taskStatus tidak dikenal.", code: "INVALID_TASK_STATUS" }, { status: 400 })
    }
    // Sections are the status options (owner, 12 Oct 2026; lib/status-sections.ts). A new section names
    // its status; one that does not (every released app) joins the To-do group when the project already
    // works that way, and stays a plain section in a project that does not.
    let taskStatus = rawStatus ?? null
    if (taskStatus === null && rawStatus === undefined) {
      const bound = await prisma.taskList.count({ where: { projectId: (await params).projectId, taskStatus: { not: null } } })
      if (bound > 0) taskStatus = "TODO"
    }

    // Auto-set position to last
    const lastSection = await prisma.taskList.findFirst({
      where: { projectId: (await params).projectId },
      orderBy: { position: "desc" },
      select: { position: true },
    })

    const section = await prisma.taskList.create({
      data: {
        name: name.trim(),
        projectId: (await params).projectId,
        position: (lastSection?.position ?? -1) + 1,
        taskStatus,
        color: cleanColor(color),
      },
    })

    return NextResponse.json(section, { status: 201 })
  } catch (error) {
    console.error("Error creating section:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    const body = await request.json()
    const { id, name, position, taskStatus, color } = body

    if (!id) {
      return NextResponse.json({ error: "Section id is required" }, { status: 400 })
    }
    // The task status this section stands for (project templates, 12 Oct 2026): one of the five, or null
    // for a plain section. Applies to tasks moved in from now on; tasks already here keep theirs.
    if (taskStatus !== undefined && taskStatus !== null && !SECTION_TASK_STATUSES.includes(taskStatus)) {
      return NextResponse.json({ error: "taskStatus tidak dikenal.", code: "INVALID_TASK_STATUS" }, { status: 400 })
    }

    const existing = await prisma.taskList.findUnique({ where: { id } })
    if (!existing || existing.projectId !== (await params).projectId) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 })
    }

    // Handle reorder: shift other sections
    if (position !== undefined && position !== existing.position) {
      const oldPos = existing.position
      const newPos = position

      if (newPos < oldPos) {
        // Moving up: shift items in [newPos, oldPos) down by 1
        await prisma.taskList.updateMany({
          where: {
            projectId: (await params).projectId,
            position: { gte: newPos, lt: oldPos },
          },
          data: { position: { increment: 1 } },
        })
      } else {
        // Moving down: shift items in (oldPos, newPos] up by 1
        await prisma.taskList.updateMany({
          where: {
            projectId: (await params).projectId,
            position: { gt: oldPos, lte: newPos },
          },
          data: { position: { decrement: 1 } },
        })
      }
    }

    const section = await prisma.taskList.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(position !== undefined && { position }),
        ...(taskStatus !== undefined && { taskStatus }),
        ...(color !== undefined && { color: cleanColor(color) }),
      },
    })

    return NextResponse.json(section)
  } catch (error) {
    console.error("Error updating section:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: MEMBER role or higher required" }, { status: 403 })
    }

    const body = await request.json()
    const { id, moveTo } = body

    if (!id) {
      return NextResponse.json({ error: "Section id is required" }, { status: 400 })
    }

    const allSections = await prisma.taskList.findMany({
      where: { projectId: (await params).projectId },
      orderBy: { position: "asc" },
    })

    if (allSections.length <= 1) {
      return NextResponse.json({ error: "Cannot delete the last section" }, { status: 400 })
    }

    const target = allSections.find((s) => s.id === id)
    if (!target) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 })
    }

    // Move tasks to first remaining section, delete, re-normalize positions — one transaction, after
    // keeping the section and where each task came from, so Control Room → Audit can restore it: the
    // section returns at its old place and its tasks move back (unless someone has moved them since).
    // "Move tasks to…" (owner, 12 Oct 2026, Notion-style statuses): the section the deleting person
    // picked, else the first remaining one. Moved tasks take its status when it stands for one, so the
    // board stays true; a restore moves them back (their status stays as it is then).
    const firstRemaining = allSections.find((s) => s.id === moveTo && s.id !== id) ?? allSections.find((s) => s.id !== id)!
    const projectId = (await params).projectId
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
    const tasksMoved = await prisma.task.count({ where: { taskListId: id } })
    await restorableDelete({
      entityType: "task_list", entityId: id, entityName: target.name || "Untitled section",
      workspaceId: project?.workspaceId ?? null, userId: session.user.id!, request,
      metadata: { projectId, movedTo: firstRemaining.id, movedToName: firstRemaining.name, tasksMoved },
      meta: { open: { type: "project", id: projectId }, projectId },
      before: async (tx) => {
        const moved = await tx.task.findMany({ where: { taskListId: id }, select: { id: true } })
        await tx.task.updateMany({ where: { taskListId: id }, data: { taskListId: firstRemaining.id, ...(firstRemaining.taskStatus ? { status: firstRemaining.taskStatus } : {}) } })
        return moved.map((t) => ({ table: "Task", column: "taskListId", key: t.id, value: id, movedTo: firstRemaining.id }))
      },
      remove: async (tx) => {
        await tx.taskList.delete({ where: { id } })
        const remaining = allSections.filter((s) => s.id !== id)
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].position !== i) {
            await tx.taskList.update({ where: { id: remaining[i].id }, data: { position: i } })
          }
        }
      },
    })

    return NextResponse.json({ message: "Section deleted", movedTo: firstRemaining.id })
  } catch (error) {
    console.error("Error deleting section:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
