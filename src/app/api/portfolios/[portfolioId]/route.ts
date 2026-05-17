export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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

    await prisma.portfolio.delete({ where: { id: portfolioId } })

    logAudit({ action: "delete", entityType: "portfolio", entityId: portfolioId, entityName: existing.name, userId: session.user.id })

    return NextResponse.json({ message: "Portfolio deleted" })
  } catch (error) {
    console.error("Error deleting portfolio:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
