export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const dependencies = await prisma.taskDependency.findMany({
      where: { taskId: (await params).taskId },
      include: { dependsOnTask: { select: { id: true, title: true, status: true } } },
    })
    const dependedOnBy = await prisma.taskDependency.findMany({
      where: { dependsOnTaskId: (await params).taskId },
      include: { task: { select: { id: true, title: true, status: true } } },
    })
    return NextResponse.json({ dependencies, dependedOnBy })
  } catch (error) {
    console.error("Error fetching dependencies:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { dependsOnTaskId, type } = await req.json()
    if (!dependsOnTaskId) return NextResponse.json({ error: 'dependsOnTaskId required' }, { status: 400 })
    const dep = await prisma.taskDependency.create({
      data: { taskId: (await params).taskId, dependsOnTaskId, type: type || 'BLOCKING' },
      include: { dependsOnTask: { select: { id: true, title: true, status: true } } },
    })

    logAudit({ action: "create", entityType: "task_dependency", entityId: dep.id, userId: session.user.id, request: req, metadata: { taskId: (await params).taskId, dependsOnTaskId } })

    return NextResponse.json({ dependency: dep }, { status: 201 })
  } catch (error) {
    console.error("Error creating dependency:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.taskDependency.delete({ where: { id } })

    logAudit({ action: "delete", entityType: "task_dependency", entityId: id, userId: session.user.id, request: req })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting dependency:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
