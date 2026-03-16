import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { extractTextFromTipTap } from '@/lib/tiptap-utils'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = req.nextUrl.searchParams
  const projectId = searchParams.get('projectId')

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId

  const docs = await prisma.doc.findMany({
    where,
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      owner: { select: { id: true, name: true, avatar: true } },
      project: { select: { id: true, name: true, color: true } },
    },
    orderBy: [{ position: 'asc' }, { updatedAt: 'desc' }],
  })
  return NextResponse.json({ docs })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { title, content, projectId, parentId } = await req.json()
  if (!title || !projectId) return NextResponse.json({ error: 'Title and projectId required' }, { status: 400 })
  const doc = await prisma.doc.create({
    data: {
      title,
      content: content || null,
      contentText: content ? extractTextFromTipTap(content) : null,
      projectId,
      authorId: session.user.id,
      ownerId: session.user.id,
      parentId: parentId || null,
    },
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      owner: { select: { id: true, name: true, avatar: true } },
      project: { select: { id: true, name: true, color: true } },
    },
  })
  logAudit({ action: "create", entityType: "doc", entityId: doc.id, entityName: title, userId: session.user.id, request: req })

  return NextResponse.json({ doc }, { status: 201 })
}
