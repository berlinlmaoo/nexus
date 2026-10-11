export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"

/**
 * GET → { covers: { [taskId]: { url, attachmentId } } } (owner, 12 Oct 2026): the cover of each task card
 * in a Gallery view — the task's FIRST image attachment (oldest upload; payout proofs excluded). Tasks
 * without an image are left out. One query for the whole project, so the gallery does not fetch every
 * task's attachment list.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["GUEST"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const rows = await prisma.attachment.findMany({
      where: {
        kind: { not: "PROOF" },
        mimeType: { startsWith: "image/" },
        task: { OR: [{ taskList: { projectId } }, { taskProjects: { some: { projectId } } }] },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, taskId: true, url: true },
      take: 5000,
    })
    const covers: Record<string, { url: string; attachmentId: string }> = {}
    for (const r of rows) if (!covers[r.taskId]) covers[r.taskId] = { url: r.url, attachmentId: r.id }
    return NextResponse.json({ covers })
  } catch (error) {
    console.error("Error listing task covers:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
