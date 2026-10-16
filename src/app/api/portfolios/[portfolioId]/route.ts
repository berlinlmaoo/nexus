export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { firstUnlinkableProject, workspaceItemWriteRefusal } from "@/lib/write-access"
import { isWorkspaceMemberOf } from "@/lib/read-access"
import { logAudit } from "@/lib/audit"
import { restorableDelete } from "@/lib/deletion-snapshot"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // Signed in is not enough (API.md E5): the portfolios list shows a workspace's portfolios to its members.
    const portfolioRef = await prisma.portfolio.findUnique({ where: { id: (await params).portfolioId }, select: { workspaceId: true } })
    if (!portfolioRef) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
    if (!(await isWorkspaceMemberOf(session.user.id, portfolioRef.workspaceId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { portfolioId } = await params

    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
      include: {
        owner: { select: { id: true, name: true, email: true, avatar: true } },
        projects: {
          include: {
            project: {
              include: {
                taskLists: {
                  include: {
                    tasks: {
                      select: { id: true, status: true, dueDate: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
    }

    const now = new Date()
    const projectsWithStats = portfolio.projects.map((pp) => {
      const allTasks = pp.project.taskLists.flatMap((tl) => tl.tasks)
      const total = allTasks.length
      const completed = allTasks.filter((t) => t.status === "DONE").length
      const overdue = allTasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < now && t.status !== "DONE" && t.status !== "CANCELLED"
      ).length

      return {
        id: pp.project.id,
        name: pp.project.name,
        status: pp.project.status,
        color: pp.project.color,
        taskStats: { total, completed, overdue },
      }
    })

    const totalTasks = projectsWithStats.reduce((s, p) => s + p.taskStats.total, 0)
    const completedTasks = projectsWithStats.reduce((s, p) => s + p.taskStats.completed, 0)
    const overdueTasks = projectsWithStats.reduce((s, p) => s + p.taskStats.overdue, 0)
    const healthScore = totalTasks > 0
      ? Math.round(((completedTasks / totalTasks) * 70) + ((1 - overdueTasks / Math.max(totalTasks, 1)) * 30))
      : 100

    return NextResponse.json({
      id: portfolio.id,
      name: portfolio.name,
      description: portfolio.description,
      status: portfolio.status,
      owner: portfolio.owner,
      createdAt: portfolio.createdAt,
      updatedAt: portfolio.updatedAt,
      projects: projectsWithStats,
      healthScore,
      taskStats: { total: totalTasks, completed: completedTasks, overdue: overdueTasks },
    })
  } catch (error) {
    console.error("Error fetching portfolio:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { portfolioId } = await params
    const { name, description, status, projectIds, addProjectIds, removeProjectIds } = await request.json()

    const existing = await prisma.portfolio.findUnique({ where: { id: portfolioId } })
    if (!existing) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
    }
    // Signed in is not enough (writes batch): members of the portfolio's workspace.
    const refusal = await workspaceItemWriteRefusal(session.user.id, existing.workspaceId)
    if (refusal) return refusal

    const idList = (v: unknown) => (Array.isArray(v) ? v.filter((id: unknown): id is string => typeof id === "string") : null)
    if (projectIds !== undefined && !Array.isArray(projectIds)) {
      return NextResponse.json({ error: "projectIds must be an array" }, { status: 400 })
    }
    const whole = projectIds !== undefined ? idList(projectIds)! : null
    const toAdd = idList(addProjectIds) ?? []
    const toRemove = new Set(idList(removeProjectIds) ?? [])

    if (whole || toAdd.length || toRemove.size) {
      // Race audit 16 Oct 2026 (M13): deleteMany + createMany outside a transaction — 10 saves of one list at once
      // answered 6 × 500 (unique violation). Now one transaction with the portfolio row locked: the links stored
      // NOW are read, the request applied to them (the whole `projectIds`, and/or `addProjectIds` /
      // `removeProjectIds`, which never undo what someone else linked meanwhile), and only the difference written.
      // Only projects ADDED are checked (same workspace, or one the caller can open).
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id = ${portfolioId} FOR UPDATE`
        const linked = (await tx.portfolioProject.findMany({ where: { portfolioId }, select: { projectId: true } })).map((row) => row.projectId)
        let next = whole ? [...new Set(whole)] : [...linked]
        for (const id of toAdd) if (!next.includes(id)) next.push(id)
        next = next.filter((id) => !toRemove.has(id))
        const added = next.filter((id) => !linked.includes(id))
        const removed = linked.filter((id) => !next.includes(id))
        if (await firstUnlinkableProject(session.user.id!, added, existing.workspaceId)) return "forbidden" as const
        if (removed.length) await tx.portfolioProject.deleteMany({ where: { portfolioId, projectId: { in: removed } } })
        if (added.length) await tx.portfolioProject.createMany({ data: added.map((projectId) => ({ portfolioId, projectId })), skipDuplicates: true })
        return "ok" as const
      })
      if (result === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const portfolio = await prisma.portfolio.update({
      where: { id: portfolioId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
      },
      include: {
        owner: { select: { id: true, name: true, email: true, avatar: true } },
        projects: {
          include: {
            project: {
              select: { id: true, name: true, status: true, color: true },
            },
          },
        },
      },
    })

    logAudit({ action: "update", entityType: "portfolio", entityId: portfolioId, entityName: portfolio.name, userId: session.user.id, request, metadata: { changes: { name, description, status, projectIds, addProjectIds, removeProjectIds } } })

    return NextResponse.json(portfolio)
  } catch (error) {
    console.error("Error updating portfolio:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { portfolioId } = await params

    const existing = await prisma.portfolio.findUnique({ where: { id: portfolioId } })
    if (!existing) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
    }
    // Signed in is not enough (writes batch): members of the portfolio's workspace.
    const refusal = await workspaceItemWriteRefusal(session.user.id, existing.workspaceId)
    if (refusal) return refusal

    // Kept with its project links first, so Control Room → Audit can restore it.
    await restorableDelete({
      entityType: "portfolio", entityId: portfolioId, entityName: existing.name, workspaceId: existing.workspaceId,
      userId: session.user.id, request: _request, meta: { open: { type: "portfolio", id: portfolioId } },
      remove: (tx) => tx.portfolio.delete({ where: { id: portfolioId } }),
    })

    return NextResponse.json({ message: "Portfolio deleted" })
  } catch (error) {
    console.error("Error deleting portfolio:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
