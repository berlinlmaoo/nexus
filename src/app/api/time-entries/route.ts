import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const taskId = searchParams.get('taskId')
    const entries = await prisma.timeEntry.findMany({
      where: taskId ? { taskId } : {},
      include: { user: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
      orderBy: { startTime: 'desc' },
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
    const { taskId, startTime, endTime, duration, description } = await req.json()
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
    const entry = await prisma.timeEntry.create({
      data: { taskId, userId: session.user.id, startTime: new Date(startTime || Date.now()), endTime: endTime ? new Date(endTime) : null, duration: duration || null, description: description || null },
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
    const { id, endTime, duration, description } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const entry = await prisma.timeEntry.update({
      where: { id },
      data: { ...(endTime !== undefined && { endTime: new Date(endTime) }), ...(duration !== undefined && { duration }), ...(description !== undefined && { description }) },
    })

    logAudit({ action: "update", entityType: "time_entry", entityId: id, userId: session.user.id, request: req })

    return NextResponse.json({ entry })
  } catch (error) {
    console.error("Error updating time entry:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
