export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { docWriteRefusal } from '@/lib/write-access'
import { canReadProjectContent } from "@/lib/read-access"
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { extractTextFromTipTap } from '@/lib/tiptap-utils'

export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Signed in is not enough (API.md E5). Search lists every doc of the searcher's workspaces, so the
    // bar is the doc's workspace (or its project), not the docs list's project-member filter.
    const docRef = await prisma.doc.findUnique({ where: { id: (await params).docId }, select: { projectId: true } })
    if (!docRef) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(await canReadProjectContent(session.user.id, docRef.projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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

    // Signed in is not enough (writes batch): the doc page's own rule (GET above) — whoever opens a doc
    // there can edit it.
    const target = await prisma.doc.findUnique({ where: { id: (await params).docId }, select: { projectId: true } })
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const refusal = await docWriteRefusal(session.user.id, target.projectId)
    if (refusal) return refusal
    if (body.parentId) {
      const parent = await prisma.doc.findUnique({ where: { id: String(body.parentId) }, select: { id: true, projectId: true } })
      if (!parent || parent.projectId !== target.projectId || parent.id === (await params).docId) {
        return NextResponse.json({ error: 'Parent doc not found in this project' }, { status: 400 })
      }
    }

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

    const existing = await prisma.doc.findUnique({ where: { id: (await params).docId }, select: { title: true, projectId: true } })
    // Signed in is not enough (writes batch): the doc page's own rule, as for PATCH.
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const refusal = await docWriteRefusal(session.user.id, existing.projectId)
    if (refusal) return refusal
    logAudit({ action: "delete", entityType: "doc", entityId: (await params).docId, entityName: existing?.title, userId: session.user.id, request: req })

    await prisma.doc.delete({ where: { id: (await params).docId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting doc:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
