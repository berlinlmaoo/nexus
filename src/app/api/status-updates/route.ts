import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const projectId = request.nextUrl.searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const updates = await prisma.statusUpdate.findMany({
      where: { projectId },
      include: { author: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(updates)
  } catch (error) {
    console.error("Error fetching status updates:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { projectId, status, text } = await request.json()

    if (!projectId || !text) {
      return NextResponse.json({ error: "projectId and text are required" }, { status: 400 })
    }

    const update = await prisma.statusUpdate.create({
      data: {
        status: status || undefined,
        text,
        projectId,
        authorId: session.user.id,
      },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    })

    logAudit({ action: "create", entityType: "status_update", entityId: update.id, entityName: text.substring(0, 50), userId: session.user.id, request, metadata: { projectId, status } })

    return NextResponse.json(update, { status: 201 })
  } catch (error) {
    console.error("Error creating status update:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
