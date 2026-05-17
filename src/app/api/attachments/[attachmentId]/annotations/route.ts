export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: { attachmentId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  { params }: { params: { attachmentId: string } }
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
  { params }: { params: { attachmentId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await params
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'Annotation id is required' }, { status: 400 })

    const annotation = await prisma.proofAnnotation.findUnique({ where: { id } })
    if (!annotation) return NextResponse.json({ error: 'Annotation not found' }, { status: 404 })

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
  { params }: { params: { attachmentId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await params
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Annotation id is required' }, { status: 400 })

    const annotation = await prisma.proofAnnotation.findUnique({ where: { id } })
    if (!annotation) return NextResponse.json({ error: 'Annotation not found' }, { status: 404 })

    if (annotation.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden: only the author can delete this annotation' }, { status: 403 })
    }

    await prisma.proofAnnotation.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting annotation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
