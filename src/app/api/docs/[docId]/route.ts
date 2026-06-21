export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { extractTextFromTipTap } from '@/lib/tiptap-utils'

export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const doc = await prisma.doc.findUnique({
      where: { id: (await params).docId },
      include: {
        author: { select: { id: true, name: true, avatar: true } },
        owner: { select: { id: true, name: true, avatar: true } },
        project: { select: { id: true, name: true, color: true } },
      },
    })
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ doc })
  } catch (error) {
    console.error('Error fetching doc:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()

    const data: Record<string, unknown> = {}
    if (body.title !== undefined) data.title = body.title
    if (body.content !== undefined) {
      data.content = body.content
      data.contentText = body.content ? extractTextFromTipTap(body.content) : null
    }
    if (body.parentId !== undefined) data.parentId = body.parentId
    if (body.position !== undefined) data.position = body.position
    if (body.icon !== undefined) data.icon = body.icon
    if (body.coverImage !== undefined) data.coverImage = body.coverImage
    if (body.verificationStatus !== undefined) data.verificationStatus = body.verificationStatus
    if (body.verifiedAt !== undefined) data.verifiedAt = new Date(body.verifiedAt)
    if (body.ownerId !== undefined) data.ownerId = body.ownerId

    const doc = await prisma.doc.update({
      where: { id: (await params).docId },
      data,
      include: {
        author: { select: { id: true, name: true, avatar: true } },
        owner: { select: { id: true, name: true, avatar: true } },
        project: { select: { id: true, name: true, color: true } },
      },
    })

    logAudit({ action: "update", entityType: "doc", entityId: (await params).docId, entityName: doc.title, userId: session.user.id, request: req, metadata: { changes: Object.keys(body) } })

    return NextResponse.json({ doc })
  } catch (error) {
    console.error('Error updating doc:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const existing = await prisma.doc.findUnique({ where: { id: (await params).docId }, select: { title: true } })
    logAudit({ action: "delete", entityType: "doc", entityId: (await params).docId, entityName: existing?.title, userId: session.user.id, request: req })

    await prisma.doc.delete({ where: { id: (await params).docId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting doc:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
