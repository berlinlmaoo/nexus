export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isWorkspaceMemberOf } from '@/lib/read-access'
import { docWriteRefusal } from '@/lib/write-access'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { docToText, sanitizeDoc } from '@/lib/blockdoc'
import type { InputJsonValue } from '@prisma/client/runtime/client'
import { contentForClient } from '@/lib/block-bodies'

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
    return NextResponse.json({ docs: docs.map((d) => contentForClient(req, d)) })
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
    // Signed in is not enough (writes batch): whoever may open the project's docs (lib/write-access.ts).
    const refusal = await docWriteRefusal(session.user.id, projectId)
    if (refusal) return refusal
    if (parentId) {
      const parent = await prisma.doc.findUnique({ where: { id: parentId }, select: { projectId: true } })
      if (!parent || parent.projectId !== projectId) {
        return NextResponse.json({ error: 'Parent doc not found in this project' }, { status: 400 })
      }
    }

    // If templateId provided, use template content
    let finalContent = content ? sanitizeDoc(content) : null
    if (content && !finalContent) return NextResponse.json({ error: 'content must be a document ({ type: "doc", content: [...] })' }, { status: 400 })
    if (templateId && !content) {
      const template = await prisma.docTemplate.findUnique({ where: { id: templateId } })
      if (template?.content && (await isWorkspaceMemberOf(session.user.id, template.workspaceId))) {
        finalContent = sanitizeDoc(template.content)
      }
    }

    const doc = await prisma.doc.create({
      data: {
        title,
        content: finalContent ? (finalContent as unknown as InputJsonValue) : undefined,
        contentText: finalContent ? docToText(finalContent) || null : null,
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
