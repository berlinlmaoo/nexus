import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function GET() {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id as string
    const now = new Date()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)

    const [
      totalTasks,
      inProgressTasks,
      overdueTasks,
      completedThisWeek,
      myTasks,
      recentActivity,
      projects,
      goals,
      activeSprints,
    ] = await Promise.all([
      prisma.taskAssignee.count({ where: { userId } }),

      prisma.taskAssignee.count({
        where: { userId, task: { status: "IN_PROGRESS" } },
      }),

      prisma.taskAssignee.count({
        where: {
          userId,
          task: {
            status: { notIn: ["DONE", "CANCELLED"] },
            dueDate: { not: null, lt: now },
          },
        },
      }),

      prisma.taskAssignee.count({
        where: {
          userId,
          task: { status: "DONE", updatedAt: { gte: startOfWeek } },
        },
      }),

      prisma.task.findMany({
        where: {
          assignees: { some: { userId } },
          status: { notIn: ["DONE", "CANCELLED"] },
        },
        orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
        take: 10,
        include: {
          taskList: {
            include: {
              project: { select: { id: true, name: true, color: true } },
            },
          },
        },
      }),

      prisma.activityLog.findMany({
        where: {
          OR: [
            { userId },
            { project: { members: { some: { userId } } } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 15,
        include: {
          user: { select: { id: true, name: true, avatar: true } },
          task: { select: { id: true, title: true } },
          project: { select: { id: true, name: true } },
        },
      }),

      prisma.project.findMany({
        where: {
          members: { some: { userId } },
          status: "ACTIVE",
        },
        include: {
          taskLists: {
            include: {
              tasks: { select: { status: true } },
            },
          },
        },
      }),

      prisma.goal.findMany({
        where: {
          workspace: { members: { some: { userId } } },
        },
        include: {
          owner: { select: { name: true } },
          milestones: true,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),

      prisma.sprint.findMany({
        where: {
          status: "ACTIVE",
          project: { members: { some: { userId } } },
        },
        include: {
          project: { select: { name: true, color: true } },
          tasks: {
            include: {
              task: { select: { status: true } },
            },
          },
        },
        take: 3,
      }),
    ])

    const projectsWithProgress = projects.map((project) => {
      const allTasks = project.taskLists.flatMap((tl) => tl.tasks)
      const totalProjectTasks = allTasks.length
      const doneTasks = allTasks.filter((t) => t.status === "DONE").length
      const progress =
        totalProjectTasks > 0
          ? Math.round((doneTasks / totalProjectTasks) * 100)
          : 0

      return {
        id: project.id,
        name: project.name,
        color: project.color,
        totalTasks: totalProjectTasks,
        completedTasks: doneTasks,
        progress,
      }
    })

    const goalsData = goals.map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      progress: g.progress,
      owner: g.owner.name,
      milestonesTotal: g.milestones.length,
      milestonesCompleted: g.milestones.filter((m) => m.completed).length,
    }))

    const sprintsData = activeSprints.map((s) => {
      const total = s.tasks.length
      const done = s.tasks.filter((t) => t.task.status === "DONE").length
      return {
        id: s.id,
        name: s.name,
        project: s.project.name,
        projectColor: s.project.color,
        totalTasks: total,
        completedTasks: done,
        progress: total > 0 ? Math.round((done / total) * 100) : 0,
      }
    })

    return NextResponse.json({
      stats: {
        totalTasks,
        inProgressTasks,
        overdueTasks,
        completedThisWeek,
      },
      tasks: myTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        project: task.taskList.project,
      })),
      activity: recentActivity.map((log) => ({
        id: log.id,
        action: log.action,
        details: log.details,
        createdAt: log.createdAt,
        user: log.user,
        task: log.task,
        project: log.project,
      })),
      projects: projectsWithProgress,
      goals: goalsData,
      sprints: sprintsData,
    })
  } catch (error) {
    console.error("Dashboard API error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
