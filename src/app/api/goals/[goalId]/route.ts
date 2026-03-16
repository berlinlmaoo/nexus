import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

const goalInclude = {
  owner: { select: { id: true, name: true, avatar: true } },
  milestones: { orderBy: { dueDate: 'asc' as const } },
  goalProjects: {
    include: {
      project: {
        select: {
          id: true,
          name: true,
          color: true,
          status: true,
        },
      },
    },
  },
  goalTasks: {
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          taskList: { select: { project: { select: { id: true, name: true, color: true } } } },
        },
      },
    },
  },
}

async function recalculateProgress(goalId: string) {
  const goalTasks = await prisma.goalTask.findMany({
    where: { goalId },
    include: { task: { select: { status: true } } },
  })
  if (goalTasks.length === 0) return
  const completed = goalTasks.filter(gt => gt.task.status === 'DONE').length
  const progress = Math.round((completed / goalTasks.length) * 100)
  await prisma.goal.update({ where: { id: goalId }, data: { progress } })
}

export async function GET(req: NextRequest, { params }: { params: { goalId: string } }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const goal = await prisma.goal.findUnique({
      where: { id: params.goalId },
      include: goalInclude,
    })
    if (!goal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Compute task completion stats
    const totalTasks = goal.goalTasks.length
    const completedTasks = goal.goalTasks.filter(gt => gt.task.status === 'DONE').length

    return NextResponse.json({
      goal: {
        ...goal,
        linkedProjects: goal.goalProjects.map(gp => gp.project),
        linkedTasks: goal.goalTasks.map(gt => ({
          ...gt.task,
          project: gt.task.taskList?.project || null,
        })),
        taskStats: { total: totalTasks, completed: completedTasks },
      },
    })
  } catch (error) {
    console.error('Error fetching goal:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { goalId: string } }) {
  try {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()

  // Link/unlink project
  if (body.linkProject) {
    await prisma.goalProject.upsert({
      where: { goalId_projectId: { goalId: params.goalId, projectId: body.linkProject } },
      create: { goalId: params.goalId, projectId: body.linkProject },
      update: {},
    })
  }
  if (body.unlinkProject) {
    await prisma.goalProject.deleteMany({
      where: { goalId: params.goalId, projectId: body.unlinkProject },
    })
  }

  // Link/unlink task
  if (body.linkTask) {
    await prisma.goalTask.upsert({
      where: { goalId_taskId: { goalId: params.goalId, taskId: body.linkTask } },
      create: { goalId: params.goalId, taskId: body.linkTask },
      update: {},
    })
    await recalculateProgress(params.goalId)
  }
  if (body.unlinkTask) {
    await prisma.goalTask.deleteMany({
      where: { goalId: params.goalId, taskId: body.unlinkTask },
    })
    await recalculateProgress(params.goalId)
  }

  if (body.addMilestone) {
    await prisma.goalMilestone.create({ data: { goalId: params.goalId, title: body.addMilestone.title, dueDate: body.addMilestone.dueDate ? new Date(body.addMilestone.dueDate) : null } })
  }
  if (body.toggleMilestone) {
    await prisma.goalMilestone.update({ where: { id: body.toggleMilestone.id }, data: { completed: body.toggleMilestone.completed } })
    const milestones = await prisma.goalMilestone.findMany({ where: { goalId: params.goalId } })
    const completed = milestones.filter(m => m.completed).length
    const progress = milestones.length > 0 ? Math.round((completed / milestones.length) * 100) : 0
    // Only auto-set milestone progress if no linked tasks
    const taskCount = await prisma.goalTask.count({ where: { goalId: params.goalId } })
    if (taskCount === 0) {
      await prisma.goal.update({ where: { id: params.goalId }, data: { progress } })
    }
  }

  const { title, description, status, progress, dueDate, parentId } = body
  if (title !== undefined || description !== undefined || status !== undefined || progress !== undefined || dueDate !== undefined || parentId !== undefined) {
    await prisma.goal.update({
      where: { id: params.goalId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(progress !== undefined && { progress }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(parentId !== undefined && { parentId: parentId || null }),
      },
    })
  }

  // If this goal has a parent, recalculate parent progress = average of children
  const updatedGoal = await prisma.goal.findUnique({ where: { id: params.goalId }, select: { parentId: true } })
  if (updatedGoal?.parentId) {
    const siblings = await prisma.goal.findMany({ where: { parentId: updatedGoal.parentId }, select: { progress: true } })
    if (siblings.length > 0) {
      const avgProgress = Math.round(siblings.reduce((sum, s) => sum + s.progress, 0) / siblings.length)
      await prisma.goal.update({ where: { id: updatedGoal.parentId }, data: { progress: avgProgress } })
    }
  }

  const goal = await prisma.goal.findUnique({
    where: { id: params.goalId },
    include: goalInclude,
  })
  if (!goal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const totalTasks = goal.goalTasks.length
  const completedTasks = goal.goalTasks.filter(gt => gt.task.status === 'DONE').length

  logAudit({ action: 'update', entityType: 'goal', entityId: params.goalId, entityName: goal.title, userId: session.user.id, request: req, metadata: { changes: Object.keys(body) } })

  return NextResponse.json({
    goal: {
      ...goal,
      linkedProjects: goal.goalProjects.map(gp => gp.project),
      linkedTasks: goal.goalTasks.map(gt => ({
        ...gt.task,
        project: gt.task.taskList?.project || null,
      })),
      taskStats: { total: totalTasks, completed: completedTasks },
    },
  })
  } catch (error) {
    console.error('Error updating goal:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { goalId: string } }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    await prisma.goal.delete({ where: { id: params.goalId } })
    logAudit({ action: 'delete', entityType: 'goal', entityId: params.goalId, userId: session.user.id, request: req })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting goal:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
