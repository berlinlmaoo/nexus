export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { taskWriteRefusal } from '@/lib/write-access'
import { isUniqueViolation } from '@/lib/prisma-errors'
import { canReadTask, taskReadRefusal } from "@/lib/read-access"
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Signed in is not enough (API.md E5): whoever may open the task (lib/read-access.ts).
    const readable = await canReadTask(session.user.id, (await params).taskId)
    if (readable !== "ok") return taskReadRefusal(readable)
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
    // Signed in is not enough (writes batch): whoever may open the task — and the task it is made to
    // depend on (its title comes back in the dependency list).
    const refusal =
      (await taskWriteRefusal(session.user.id, (await params).taskId)) ??
      (await taskWriteRefusal(session.user.id, String(dependsOnTaskId)))
    if (refusal) return refusal
    const dep = await prisma.taskDependency
      .create({
        data: { taskId: (await params).taskId, dependsOnTaskId, type: type || 'BLOCKING' },
        include: { dependsOnTask: { select: { id: true, title: true, status: true } } },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) return null
        throw error
      })
    // Was a 500: the pair is unique (TaskDependency @@unique([taskId, dependsOnTaskId])).
    if (!dep) return NextResponse.json({ error: 'This dependency already exists' }, { status: 409 })

    logAudit({ action: "create", entityType: "task_dependency", entityId: dep.id, userId: session.user.id, request: req, metadata: { taskId: (await params).taskId, dependsOnTaskId } })

    return NextResponse.json({ dependency: dep }, { status: 201 })
  } catch (error) {
    console.error("Error creating dependency:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    // Signed in is not enough (writes batch): the dependency must hang off the task in the path (either
    // end — the panel lists both "blocked by" and "blocking"), and the caller must be able to open it.
    const { taskId } = await params
    const depRef = await prisma.taskDependency.findUnique({ where: { id }, select: { taskId: true, dependsOnTaskId: true } })
    if (!depRef || (depRef.taskId !== taskId && depRef.dependsOnTaskId !== taskId)) {
      return NextResponse.json({ error: 'Dependency not found' }, { status: 404 })
    }
    const refusal = await taskWriteRefusal(session.user.id, taskId)
    if (refusal) return refusal
    await prisma.taskDependency.delete({ where: { id } })

    logAudit({ action: "delete", entityType: "task_dependency", entityId: id, userId: session.user.id, request: req })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting dependency:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
