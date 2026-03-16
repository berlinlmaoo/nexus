import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: { docId: string } }
) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const original = await prisma.doc.findUnique({
    where: { id: params.docId },
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

  return NextResponse.json({ doc: duplicate }, { status: 201 })
}
