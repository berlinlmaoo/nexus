export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { taskWriteRefusal } from '@/lib/write-access'
import { canReadTask, taskReadRefusal } from "@/lib/read-access"
import prisma from '@/lib/prisma'
import { restorableDelete } from '@/lib/deletion-snapshot'
import { auditSnippet } from '@/lib/deletion-entities'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Signed in is not enough (API.md E5): the annotations of a proof are as private as its task.
    const annotated = await prisma.attachment.findUnique({ where: { id: (await params).attachmentId }, select: { taskId: true } })
    if (!annotated) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    const readable = await canReadTask(session.user.id, annotated.taskId)
    if (readable !== "ok") return taskReadRefusal(readable)

    const { attachmentId } = await params

    const annotations = await prisma.proofAnnotation.findMany({
      where: { attachmentId },
      include: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ annotations })
  } catch (error) {
    console.error('Error fetching annotations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { attachmentId } = await params
    const { x, y, comment } = await req.json()

    if (typeof x !== 'number' || typeof y !== 'number' || !comment) {
      return NextResponse.json({ error: 'x (number), y (number), and comment (string) are required' }, { status: 400 })
    }

    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } })
    if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    // Signed in is not enough (writes batch): whoever may open the attachment's task.
    const refusal = await taskWriteRefusal(session.user.id, attachment.taskId)
    if (refusal) return refusal

    const annotation = await prisma.proofAnnotation.create({
      data: {
        attachmentId,
        userId: session.user.id,
        x,
        y,
        comment,
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })

    return NextResponse.json({ annotation }, { status: 201 })
  } catch (error) {
    console.error('Error creating annotation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await params
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'Annotation id is required' }, { status: 400 })

    const annotation = await prisma.proofAnnotation.findUnique({ where: { id } })
    if (!annotation) return NextResponse.json({ error: 'Annotation not found' }, { status: 404 })
    // Signed in is not enough (writes batch): the annotation must be on the attachment in the path, and
    // the caller must be able to open that attachment's task.
    if (annotation.attachmentId !== (await params).attachmentId) {
      return NextResponse.json({ error: 'Annotation not found' }, { status: 404 })
    }
    const annotated = await prisma.attachment.findUnique({ where: { id: annotation.attachmentId }, select: { taskId: true } })
    if (!annotated) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    const refusal = await taskWriteRefusal(session.user.id, annotated.taskId)
    if (refusal) return refusal

    const updated = await prisma.proofAnnotation.update({
      where: { id },
      data: { resolved: !annotation.resolved },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })

    return NextResponse.json({ annotation: updated })
  } catch (error) {
    console.error('Error toggling annotation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await params
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Annotation id is required' }, { status: 400 })

    const annotation = await prisma.proofAnnotation.findUnique({
      where: { id },
      include: { attachment: { select: { filename: true, taskId: true, task: { select: { taskList: { select: { projectId: true, project: { select: { workspaceId: true } } } } } } } } },
    })
    if (!annotation) return NextResponse.json({ error: 'Annotation not found' }, { status: 404 })

    if (annotation.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden: only the author can delete this annotation' }, { status: 403 })
    }

    // In the audit, and kept first so Control Room → Audit can restore it.
    const taskId = annotation.attachment.taskId
    const projectId = annotation.attachment.task.taskList.projectId
    await restorableDelete({
      entityType: 'proof_annotation', entityId: id,
      entityName: auditSnippet(annotation.comment) ?? `Annotation on ${annotation.attachment.filename}`,
      workspaceId: annotation.attachment.task.taskList.project.workspaceId, userId: session.user.id, request: req,
      metadata: { attachmentId: annotation.attachmentId, file: annotation.attachment.filename, taskId, projectId },
      meta: { open: { type: 'task', id: taskId, projectId }, projectId, taskId },
      remove: (tx) => tx.proofAnnotation.delete({ where: { id } }),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting annotation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
