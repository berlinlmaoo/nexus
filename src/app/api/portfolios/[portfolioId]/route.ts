export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { firstUnlinkableProject, workspaceItemWriteRefusal } from "@/lib/write-access"
import { isWorkspaceMemberOrAdmin } from "@/lib/read-access"
import { logAudit } from "@/lib/audit"

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
    if (!(await isWorkspaceMemberOrAdmin(session.user.id, portfolioRef.workspaceId))) {
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
    const { name, description, status, projectIds } = await request.json()

    const existing = await prisma.portfolio.findUnique({ where: { id: portfolioId } })
    if (!existing) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
    }
    // Signed in is not enough (writes batch): members of the portfolio's workspace (or a system admin).
    const refusal = await workspaceItemWriteRefusal(session.user.id, existing.workspaceId)
    if (refusal) return refusal

    if (projectIds !== undefined) {
      if (!Array.isArray(projectIds)) {
        return NextResponse.json({ error: "projectIds must be an array" }, { status: 400 })
      }
      // Only projects ADDED now are checked (same workspace, or one the caller can open); the list is
      // sent whole, so the ones already in it (perhaps added by a system admin) are kept as they are.
      const linked = new Set(
        (await prisma.portfolioProject.findMany({ where: { portfolioId }, select: { projectId: true } })).map((row) => row.projectId),
      )
      const added = projectIds.filter((id: unknown): id is string => typeof id === "string" && !linked.has(id))
      if (await firstUnlinkableProject(session.user.id, added, existing.workspaceId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    if (projectIds !== undefined) {
      await prisma.portfolioProject.deleteMany({ where: { portfolioId } })
      if (projectIds.length > 0) {
        await prisma.portfolioProject.createMany({
          data: projectIds.map((projectId: string) => ({ portfolioId, projectId })),
        })
      }
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

    logAudit({ action: "update", entityType: "portfolio", entityId: portfolioId, entityName: portfolio.name, userId: session.user.id, request, metadata: { changes: { name, description, status, projectIds } } })

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
    // Signed in is not enough (writes batch): members of the portfolio's workspace (or a system admin).
    const refusal = await workspaceItemWriteRefusal(session.user.id, existing.workspaceId)
    if (refusal) return refusal

    await prisma.portfolio.delete({ where: { id: portfolioId } })

    logAudit({ action: "delete", entityType: "portfolio", entityId: portfolioId, entityName: existing.name, userId: session.user.id })

    return NextResponse.json({ message: "Portfolio deleted" })
  } catch (error) {
    console.error("Error deleting portfolio:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
