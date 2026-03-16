import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { extractTextFromTipTap } from '@/lib/tiptap-utils'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const searchParams = req.nextUrl.searchParams
    const projectId = searchParams.get('projectId')

    const where: Record<string, unknown> = {
      // Workspace isolation: only return docs from projects the user is a member of
      project: {
        members: {
          some: { userId: session.user.id },
        },
      },
    }
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
  } catch (error) {
    console.error('Error fetching docs:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { title, content, projectId, parentId, templateId } = await req.json()
    if (!title || !projectId) return NextResponse.json({ error: 'Title and projectId required' }, { status: 400 })

    // If templateId provided, use template content
    let finalContent = content || null
    if (templateId && !content) {
      const template = await prisma.docTemplate.findUnique({ where: { id: templateId } })
      if (template?.content) finalContent = template.content
    }

    const doc = await prisma.doc.create({
      data: {
        title,
        content: finalContent,
        contentText: finalContent ? extractTextFromTipTap(finalContent) : null,
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
  } catch (error) {
    console.error('Error creating doc:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
