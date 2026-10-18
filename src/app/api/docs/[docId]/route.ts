export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { docWriteRefusal } from '@/lib/write-access'
import { canReadProjectContent } from "@/lib/read-access"
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { restorableDelete } from '@/lib/deletion-snapshot'
import { sanitizeDoc } from '@/lib/blockdoc'
import { BodyConflictError, contentForClient, loadBody, saveBody } from '@/lib/block-bodies'
import { flushLiveRoom } from '@/lib/collab-rooms'
import { eventBus, BUS_EVENTS } from '@/lib/event-bus'
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
    return NextResponse.json({ doc: contentForClient(req, doc) })
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
    const docId = (await params).docId

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

    // The body (block editor): checked, stored with its text form, mentions notified, live rooms told.
    // `baseUpdatedAt` (optional) = the doc's updatedAt the editor started from; a newer one → 409, nothing written.
    let nextContent: ReturnType<typeof sanitizeDoc> = null
    if (body.content !== undefined && body.content !== null) {
      nextContent = sanitizeDoc(body.content)
      if (!nextContent) return NextResponse.json({ error: 'content must be a document ({ type: "doc", content: [...] }) under 2 MB' }, { status: 400 })
    }
    const docInclude = { author: { select: { id: true, name: true, avatar: true } }, owner: { select: { id: true, name: true, avatar: true } }, project: { select: { id: true, name: true, color: true } } } as const
    const conflict = async () => {
      const current = await prisma.doc.findUnique({ where: { id: docId }, include: docInclude })
      return NextResponse.json({ error: 'This page was changed by someone else.', code: 'DOC_CHANGED', conflict: true, doc: current }, { status: 409 })
    }
    const base = typeof body.baseUpdatedAt === 'string' ? body.baseUpdatedAt : undefined
    // A header-only save with a base: checked here. A body save checks its base INSIDE saveBody's transaction,
    // under the row lock (race audit 16 Oct 2026, M10) — this check alone let 3 of 20 saves from one base land.
    if (base && !nextContent) {
      const now = await prisma.doc.findUnique({ where: { id: docId }, select: { updatedAt: true } })
      if (now && now.updatedAt.toISOString() !== base) return conflict()
    }

    const data: Record<string, unknown> = {}
    if (body.title !== undefined) data.title = String(body.title ?? '').slice(0, 500) || 'Untitled'
    if (body.content === null) {
      data.content = null
      data.contentText = null
    }
    if (body.parentId !== undefined) data.parentId = body.parentId
    if (body.position !== undefined) data.position = body.position
    if (body.icon !== undefined) data.icon = body.icon ? String(body.icon).slice(0, 64) : null
    if (body.coverImage !== undefined) data.coverImage = typeof body.coverImage === 'string' && /^(\/|https:\/\/|gradient:)/.test(body.coverImage) ? body.coverImage.slice(0, 1000) : null
    if (body.fullWidth !== undefined) data.fullWidth = !!body.fullWidth
    if (body.verificationStatus !== undefined) data.verificationStatus = body.verificationStatus
    if (body.verifiedAt !== undefined) data.verifiedAt = new Date(body.verifiedAt)
    if (body.ownerId !== undefined) data.ownerId = body.ownerId

    let replacedLive: string | null = null
    if (nextContent) {
      // Live editors' unsaved typing is stored first (race audit H9), so a base check below sees it and a save
      // without a base replaces it knowingly (kept in this audit row as replacedLiveText).
      const live = await flushLiveRoom(`doc:${docId}`)
      const loaded = await loadBody('doc', docId)
      if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (data.title) loaded.title = data.title as string
      try {
        await saveBody(loaded, nextContent, { actorId: session.user.id, expect: base ? { updatedAt: base } : undefined })
      } catch (e) {
        if (e instanceof BodyConflictError) return conflict()
        throw e
      }
      if (live.flushed && !base) replacedLive = live.replaced
    }

    const doc = await prisma.doc.update({
      where: { id: docId },
      data,
      include: docInclude,
    })
    if (!nextContent) eventBus.emit(BUS_EVENTS.DOC_CHANGED, { projectId: doc.projectId, docId, actorId: session.user.id })

    logAudit({ action: "update", entityType: "doc", entityId: (await params).docId, entityName: doc.title, userId: session.user.id, request: req, metadata: { changes: Object.keys(body), ...(replacedLive ? { replacedLiveText: replacedLive } : {}) } })

    return NextResponse.json({ doc: contentForClient(req, doc) })
  } catch (error) {
    console.error('Error updating doc:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const existing = await prisma.doc.findUnique({ where: { id: (await params).docId }, select: { title: true, projectId: true, project: { select: { workspaceId: true } } } })
    // Signed in is not enough (writes batch): the doc page's own rule, as for PATCH.
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const refusal = await docWriteRefusal(session.user.id, existing.projectId)
    if (refusal) return refusal
    // Kept first (its child docs only lose their parent and get it back), so Control Room → Audit can restore it.
    const docId = (await params).docId
    await restorableDelete({
      entityType: "doc", entityId: docId, entityName: existing.title, workspaceId: existing.project?.workspaceId ?? null,
      userId: session.user.id, request: req, metadata: { projectId: existing.projectId },
      meta: { open: { type: "doc", id: docId, projectId: existing.projectId }, projectId: existing.projectId },
      remove: (tx) => tx.doc.delete({ where: { id: docId } }),
    })
    // Realtime (QA final 19 Oct): the Pages list of every other open copy of this project refetches.
    eventBus.emit(BUS_EVENTS.DOC_CHANGED, { projectId: existing.projectId, docId, actorId: session.user.id })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting doc:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
