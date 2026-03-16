import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

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
}

export async function PATCH(req: NextRequest, { params }: { params: { goalId: string } }) {
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

  const { title, description, status, progress, dueDate } = body
  if (title !== undefined || description !== undefined || status !== undefined || progress !== undefined || dueDate !== undefined) {
    await prisma.goal.update({
      where: { id: params.goalId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(progress !== undefined && { progress }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      },
    })
  }

  const goal = await prisma.goal.findUnique({
    where: { id: params.goalId },
    include: goalInclude,
  })
  if (!goal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
}

export async function DELETE(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.goal.delete({ where: { id: params.goalId } })
  return NextResponse.json({ success: true })
}
