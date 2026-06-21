export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const original = await prisma.doc.findUnique({
      where: { id: (await params).docId },
    })

    if (!original)
      return NextResponse.json({ error: "Not found" }, { status: 404 })

    const duplicate = await prisma.doc.create({
      data: {
        title: `${original.title} (copy)`,
        content: original.content ?? undefined,
        projectId: original.projectId,
        authorId: session.user.id,
        parentId: original.parentId,
        icon: original.icon,
        coverImage: original.coverImage,
      },
      include: {
        author: { select: { id: true, name: true, avatar: true } },
        project: { select: { id: true, name: true, color: true } },
      },
    })

    logAudit({ action: "create", entityType: "doc", entityId: duplicate.id, entityName: duplicate.title, userId: session.user.id, request: req, metadata: { duplicatedFrom: (await params).docId } })

    return NextResponse.json({ doc: duplicate }, { status: 201 })
  } catch (error) {
    console.error("Error duplicating doc:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
