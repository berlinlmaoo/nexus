import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const searchParams = request.nextUrl.searchParams
    const projectIds = searchParams.get('projectIds')?.split(',').filter(Boolean) || []
    const memberIds = searchParams.get('memberIds')?.split(',').filter(Boolean) || []
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const days = parseInt(searchParams.get('days') || '30')

    const now = new Date()
    const dateFrom = from ? new Date(from) : new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const dateTo = to ? new Date(to) : now

    // Base filter: user's projects
    const userProjects = await prisma.project.findMany({
      where: {
        members: { some: { userId } },
        status: 'ACTIVE',
        ...(projectIds.length > 0 ? { id: { in: projectIds } } : {}),
      },
      select: { id: true, name: true, color: true },
    })

    const projectIdList = userProjects.map((p) => p.id)

    // Task base filter
    const taskBaseWhere = {
      taskList: { projectId: { in: projectIdList } },
      ...(memberIds.length > 0 ? { assignees: { some: { userId: { in: memberIds } } } } : {}),
    }

    // 1. Tasks by status
    const tasksByStatus = await prisma.task.groupBy({
      by: ['status'],
      where: taskBaseWhere,
      _count: { id: true },
    })

    // 2. Tasks by priority
    const tasksByPriority = await prisma.task.groupBy({
      by: ['priority'],
      where: taskBaseWhere,
      _count: { id: true },
    })

    // 3. Tasks completed over time (daily for the period)
    const completedTasks = await prisma.task.findMany({
      where: {
        ...taskBaseWhere,
        status: 'DONE',
        updatedAt: { gte: dateFrom, lte: dateTo },
      },
      select: { updatedAt: true },
    })

    // Group by day
    const completionByDay: Record<string, number> = {}
    const currentDate = new Date(dateFrom)
    while (currentDate <= dateTo) {
      const key = currentDate.toISOString().split('T')[0]
      completionByDay[key] = 0
      currentDate.setDate(currentDate.getDate() + 1)
    }
    for (const task of completedTasks) {
      const key = task.updatedAt.toISOString().split('T')[0]
      if (completionByDay[key] !== undefined) {
        completionByDay[key]++
      }
    }

    const completionTimeline = Object.entries(completionByDay).map(([date, count]) => ({
      date,
      completed: count,
    }))

    // 4. Tasks by assignee
    const allTasks = await prisma.task.findMany({
      where: taskBaseWhere,
      select: {
        status: true,
        assignees: {
          select: {
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    })

    const assigneeMap: Record<string, { name: string; avatar: string | null; total: number; completed: number }> = {}
    for (const task of allTasks) {
      for (const a of task.assignees) {
        if (!assigneeMap[a.user.id]) {
          assigneeMap[a.user.id] = { name: a.user.name, avatar: a.user.avatar, total: 0, completed: 0 }
        }
        assigneeMap[a.user.id].total++
        if (task.status === 'DONE') assigneeMap[a.user.id].completed++
      }
    }

    const tasksByAssignee = Object.entries(assigneeMap).map(([id, data]) => ({
      id,
      name: data.name,
      avatar: data.avatar,
      total: data.total,
      completed: data.completed,
      completionRate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
    }))

    // 5. Overdue tasks trend
    const overdueTasks = await prisma.task.findMany({
      where: {
        ...taskBaseWhere,
        status: { notIn: ['DONE', 'CANCELLED'] },
        dueDate: { lt: now },
      },
      select: { dueDate: true },
    })

    // Group overdue by the week they became overdue
    const overdueByWeek: Record<string, number> = {}
    for (const task of overdueTasks) {
      if (task.dueDate) {
        const weekStart = new Date(task.dueDate)
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        const key = weekStart.toISOString().split('T')[0]
        overdueByWeek[key] = (overdueByWeek[key] || 0) + 1
      }
    }

    const overdueTrend = Object.entries(overdueByWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, count]) => ({ week, count }))

    // 6. Sprint burndown (active sprints)
    const activeSprints = await prisma.sprint.findMany({
      where: {
        status: 'ACTIVE',
        projectId: { in: projectIdList },
      },
      include: {
        project: { select: { name: true } },
        tasks: {
          include: {
            task: { select: { status: true, updatedAt: true, createdAt: true } },
          },
        },
      },
    })

    const sprintBurndowns = activeSprints.map((sprint) => {
      const totalTasks = sprint.tasks.length
      const sprintStart = sprint.startDate
      const sprintEnd = sprint.endDate
      const sprintDays: { date: string; remaining: number; ideal: number }[] = []

      const current = new Date(sprintStart)
      const totalDays = Math.ceil((sprintEnd.getTime() - sprintStart.getTime()) / (24 * 60 * 60 * 1000))
      let dayIndex = 0

      while (current <= sprintEnd && current <= now) {
        const dateKey = current.toISOString().split('T')[0]
        const completedByDate = sprint.tasks.filter(
          (st) => st.task.status === 'DONE' && st.task.updatedAt <= current
        ).length
        const remaining = totalTasks - completedByDate
        const ideal = totalTasks - (totalTasks / totalDays) * dayIndex

        sprintDays.push({
          date: dateKey,
          remaining,
          ideal: Math.max(0, Math.round(ideal * 10) / 10),
        })

        current.setDate(current.getDate() + 1)
        dayIndex++
      }

      return {
        id: sprint.id,
        name: sprint.name,
        project: sprint.project.name,
        totalTasks,
        data: sprintDays,
      }
    })

    // 7. Team workload heatmap (person x last 7 days)
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now)
      d.setDate(d.getDate() - (6 - i))
      return d.toISOString().split('T')[0]
    })

    const recentTasks = await prisma.task.findMany({
      where: {
        ...taskBaseWhere,
        updatedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: {
        updatedAt: true,
        status: true,
        assignees: {
          select: { user: { select: { id: true, name: true } } },
        },
      },
    })

    const heatmapData: Record<string, Record<string, number>> = {}
    for (const task of recentTasks) {
      const dateKey = task.updatedAt.toISOString().split('T')[0]
      for (const a of task.assignees) {
        if (!heatmapData[a.user.id]) {
          heatmapData[a.user.id] = {}
        }
        heatmapData[a.user.id][dateKey] = (heatmapData[a.user.id][dateKey] || 0) + 1
      }
    }

    const workloadHeatmap = Object.entries(heatmapData).map(([userId, days]) => {
      const userName = recentTasks
        .flatMap((t) => t.assignees)
        .find((a) => a.user.id === userId)?.user.name || 'Unknown'
      return {
        userId,
        name: userName,
        days: last7Days.map((date) => ({ date, count: days[date] || 0 })),
      }
    })

    // 8. Project health scorecard
    const projectHealth = await Promise.all(
      userProjects.map(async (project) => {
        const tasks = await prisma.task.findMany({
          where: { taskList: { projectId: project.id } },
          select: { status: true, dueDate: true },
        })

        const total = tasks.length
        const done = tasks.filter((t) => t.status === 'DONE').length
        const overdue = tasks.filter(
          (t) => t.status !== 'DONE' && t.status !== 'CANCELLED' && t.dueDate && t.dueDate < now
        ).length
        const progress = total > 0 ? Math.round((done / total) * 100) : 0
        const overdueRate = total > 0 ? Math.round((overdue / total) * 100) : 0

        let health: 'green' | 'yellow' | 'red' = 'green'
        if (overdueRate > 30 || progress < 20) health = 'red'
        else if (overdueRate > 15 || progress < 50) health = 'yellow'

        return {
          id: project.id,
          name: project.name,
          color: project.color,
          total,
          done,
          overdue,
          progress,
          health,
        }
      })
    )

    // Metric cards data
    const totalTaskCount = allTasks.length
    const completedCount = allTasks.filter((t) => t.status === 'DONE').length
    const overdueCount = allTasks.filter(
      (t) => t.status !== 'DONE' && t.status !== 'CANCELLED'
    ).length

    // Previous period for trend comparison
    const prevFrom = new Date(dateFrom.getTime() - (dateTo.getTime() - dateFrom.getTime()))
    const prevCompletedCount = await prisma.task.count({
      where: {
        ...taskBaseWhere,
        status: 'DONE',
        updatedAt: { gte: prevFrom, lt: dateFrom },
      },
    })

    const completionTrend = prevCompletedCount > 0
      ? Math.round(((completedCount - prevCompletedCount) / prevCompletedCount) * 100)
      : 0

    // Average completion time (days)
    const completedWithDates = await prisma.task.findMany({
      where: {
        ...taskBaseWhere,
        status: 'DONE',
        updatedAt: { gte: dateFrom, lte: dateTo },
      },
      select: { createdAt: true, updatedAt: true },
      take: 200,
    })

    const avgCompletionTime = completedWithDates.length > 0
      ? Math.round(
          (completedWithDates.reduce(
            (sum, t) => sum + (t.updatedAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60 * 24),
            0
          ) / completedWithDates.length) * 10
        ) / 10
      : 0

    return NextResponse.json({
      metrics: {
        totalTasks: totalTaskCount,
        completedTasks: completedCount,
        overdueTasks: overdueCount,
        completionRate: totalTaskCount > 0 ? Math.round((completedCount / totalTaskCount) * 100) : 0,
        completionTrend,
        avgCompletionDays: avgCompletionTime,
      },
      tasksByStatus: tasksByStatus.map((g) => ({
        status: g.status,
        count: g._count.id,
      })),
      tasksByPriority: tasksByPriority.map((g) => ({
        priority: g.priority,
        count: g._count.id,
      })),
      completionTimeline,
      tasksByAssignee,
      overdueTrend,
      sprintBurndowns,
      workloadHeatmap,
      projectHealth,
      projects: userProjects,
    })
  } catch (error) {
    console.error('Reports API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
