import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { executeAutomations } from '@/lib/automation-engine'
import { emitSprintUpdated } from '@/lib/socket-emitter'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const sprints = await prisma.sprint.findMany({
      where: { projectId },
      include: { tasks: { include: { task: { select: { id: true, title: true, status: true, priority: true, assignees: { include: { user: { select: { id: true, name: true } } } } } } } } },
      orderBy: { startDate: 'desc' },
    })
    return NextResponse.json({ sprints })
  } catch (error) {
    console.error('Sprints GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { name, projectId, startDate, endDate } = await req.json()
    if (!name || !projectId || !startDate || !endDate) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const sprint = await prisma.sprint.create({
      data: { name, projectId, startDate: new Date(startDate), endDate: new Date(endDate) },
      include: { tasks: { include: { task: { select: { id: true, title: true, status: true } } } } },
    })

    logAudit({ action: "create", entityType: "sprint", entityId: sprint.id, entityName: name, userId: session.user.id, request: req, metadata: { projectId } })

    return NextResponse.json({ sprint }, { status: 201 })
  } catch (error) {
    console.error('Sprints POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id, status, addTaskId, removeTaskId, name, startDate, endDate, moveIncompleteTo } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (addTaskId) await prisma.sprintTask.create({ data: { sprintId: id, taskId: addTaskId } }).catch(() => {})
    if (removeTaskId) await prisma.sprintTask.deleteMany({ where: { sprintId: id, taskId: removeTaskId } })
    const existingSprint = await prisma.sprint.findUnique({ where: { id }, select: { status: true, projectId: true } })

    // Handle sprint completion: find incomplete tasks
    if (status === 'COMPLETED' && existingSprint && existingSprint.status !== 'COMPLETED') {
      const sprintTasks = await prisma.sprintTask.findMany({
        where: { sprintId: id },
        include: { task: { select: { id: true, title: true, status: true, priority: true, assignees: { include: { user: { select: { id: true, name: true } } } } } } },
      })
      const incompleteTasks = sprintTasks.filter(st => st.task.status !== 'DONE').map(st => st.task)

      // If there are incomplete tasks and no moveIncompleteTo directive, return them for UI to handle
      if (incompleteTasks.length > 0 && !moveIncompleteTo) {
        return NextResponse.json({ incompleteTasks, requiresAction: true })
      }

      // Handle incomplete tasks based on directive
      if (incompleteTasks.length > 0 && moveIncompleteTo) {
        const incompleteTaskIds = incompleteTasks.map(t => t.id)
        if (moveIncompleteTo === 'backlog') {
          // Remove from sprint (unassign)
          await prisma.sprintTask.deleteMany({ where: { sprintId: id, taskId: { in: incompleteTaskIds } } })
        } else if (moveIncompleteTo === 'next_sprint') {
          // Find the next PLANNING sprint in same project
          const nextSprint = await prisma.sprint.findFirst({
            where: { projectId: existingSprint.projectId, status: 'PLANNING', id: { not: id } },
            orderBy: { startDate: 'asc' },
          })
          if (nextSprint) {
            // Move tasks to next sprint
            await prisma.sprintTask.updateMany({
              where: { sprintId: id, taskId: { in: incompleteTaskIds } },
              data: { sprintId: nextSprint.id },
            })
          } else {
            // No next sprint, move to backlog
            await prisma.sprintTask.deleteMany({ where: { sprintId: id, taskId: { in: incompleteTaskIds } } })
          }
        } else if (moveIncompleteTo === 'new_sprint') {
          // Create a new sprint and move incomplete tasks there
          const completedSprint = await prisma.sprint.findUnique({ where: { id } })
          if (completedSprint) {
            const duration = completedSprint.endDate.getTime() - completedSprint.startDate.getTime()
            const newSprint = await prisma.sprint.create({
              data: {
                name: `${completedSprint.name} (Overflow)`,
                projectId: existingSprint.projectId,
                startDate: completedSprint.endDate,
                endDate: new Date(completedSprint.endDate.getTime() + duration),
                status: 'PLANNING',
              },
            })
            await prisma.sprintTask.updateMany({
              where: { sprintId: id, taskId: { in: incompleteTaskIds } },
              data: { sprintId: newSprint.id },
            })
          }
        }
      }

      // Calculate completion stats
      const allSprintTasks = await prisma.sprintTask.findMany({
        where: { sprintId: id },
        include: { task: { select: { status: true } } },
      })
      const completedTaskCount = allSprintTasks.filter(st => st.task.status === 'DONE').length
      const totalTaskCount = sprintTasks.length
      // Return completion stats alongside the sprint update
      const completionStats = { completedTaskCount, totalTaskCount, incompleteCount: incompleteTasks.length }
      // Include stats in the requiresAction response above; attach to the final response below
      ;(existingSprint as Record<string, unknown>).__completionStats = completionStats
    }

    const sprint = await prisma.sprint.update({
      where: { id },
      data: { ...(status !== undefined && { status }), ...(name !== undefined && { name }), ...(startDate !== undefined && { startDate: new Date(startDate) }), ...(endDate !== undefined && { endDate: new Date(endDate) }) },
      include: { tasks: { include: { task: { select: { id: true, title: true, status: true, priority: true } } } } },
    })

    logAudit({ action: "update", entityType: "sprint", entityId: id, entityName: sprint.name, userId: session.user.id, request: req, metadata: { status, addTaskId, removeTaskId, moveIncompleteTo } })

    // Fire automations when sprint becomes ACTIVE
    if (status === 'ACTIVE' && existingSprint && existingSprint.status !== 'ACTIVE') {
      executeAutomations(sprint.projectId, 'sprint_started', {
        userId: session.user.id!,
        projectId: sprint.projectId,
        sprintId: sprint.id,
      }).catch(() => {})
    }

    // Emit sprint updated event for real-time updates
    emitSprintUpdated(sprint.projectId, sprint)

    return NextResponse.json({ sprint })
  } catch (error) {
    console.error('Sprints PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
