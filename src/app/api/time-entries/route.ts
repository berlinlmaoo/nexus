export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { checkProjectAccess } from '@/lib/rbac'

/** Resolve a task's project id (for the workspace/project authorization check). */
async function projectIdOfTask(taskId: string): Promise<string | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { taskList: { select: { projectId: true } } } })
  return task?.taskList?.projectId ?? null
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const taskId = searchParams.get('taskId')
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

    const projectId = await projectIdOfTask(taskId)
    if (!projectId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const { allowed } = await checkProjectAccess(session.user.id, projectId, ['VIEWER'])
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const entries = await prisma.timeEntry.findMany({
      where: { taskId },
      include: { user: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
      orderBy: { startTime: 'desc' },
      take: 500,
    })
    return NextResponse.json({ entries })
  } catch (error) {
    console.error("Error fetching time entries:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => null)
    const taskId = typeof body?.taskId === 'string' ? body.taskId : ''
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

    const projectId = await projectIdOfTask(taskId)
    if (!projectId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const { allowed } = await checkProjectAccess(session.user.id, projectId, ['MEMBER'])
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const start = body?.startTime ? new Date(body.startTime) : new Date()
    const end = body?.endTime ? new Date(body.endTime) : null
    if (isNaN(start.getTime()) || (end && isNaN(end.getTime()))) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
    let duration: number | null = null
    if (body?.duration !== undefined && body?.duration !== null) {
      const d = Number(body.duration)
      if (!Number.isFinite(d) || d < 0 || d > 24 * 60 * 31) return NextResponse.json({ error: 'Invalid duration' }, { status: 400 })
      duration = Math.round(d)
    }
    const description = typeof body?.description === 'string' ? body.description.slice(0, 1000) : null

    const entry = await prisma.timeEntry.create({
      data: { taskId, userId: session.user.id, startTime: start, endTime: end, duration, description },
      include: { user: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    })

    logAudit({ action: "create", entityType: "time_entry", entityId: entry.id, userId: session.user.id, request: req, metadata: { taskId } })
    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    console.error("Error creating time entry:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Only the entry's owner, or a project manager (LEAD) of the task's project, may edit it.
    const existing = await prisma.timeEntry.findUnique({
      where: { id },
      select: { userId: true, task: { select: { taskList: { select: { projectId: true } } } } },
    })
    if (!existing) return NextResponse.json({ error: 'Time entry not found' }, { status: 404 })
    if (existing.userId !== session.user.id) {
      const projectId = existing.task?.taskList?.projectId
      const lead = projectId ? (await checkProjectAccess(session.user.id, projectId, ['LEAD'])).allowed : false
      if (!lead) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const data: { endTime?: Date | null; duration?: number | null; description?: string | null } = {}
    if (body?.endTime !== undefined) {
      if (body.endTime === null) { data.endTime = null }
      else { const e = new Date(body.endTime); if (isNaN(e.getTime())) return NextResponse.json({ error: 'Invalid endTime' }, { status: 400 }); data.endTime = e }
    }
    if (body?.duration !== undefined) {
      if (body.duration === null) { data.duration = null }
      else { const d = Number(body.duration); if (!Number.isFinite(d) || d < 0 || d > 24 * 60 * 31) return NextResponse.json({ error: 'Invalid duration' }, { status: 400 }); data.duration = Math.round(d) }
    }
    if (body?.description !== undefined) data.description = typeof body.description === 'string' ? body.description.slice(0, 1000) : null

    const entry = await prisma.timeEntry.update({ where: { id }, data })
    logAudit({ action: "update", entityType: "time_entry", entityId: id, userId: session.user.id, request: req })
    return NextResponse.json({ entry })
  } catch (error) {
    console.error("Error updating time entry:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
