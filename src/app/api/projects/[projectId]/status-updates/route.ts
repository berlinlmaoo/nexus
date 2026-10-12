export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import prisma from "@/lib/prisma"

/**
 * GET /api/projects/:id/status-updates — the same list as GET /api/status-updates?projectId=, under the
 * project's own path. It used to fall through to the HTML 404 page; now an id without access answers JSON
 * 403 like every project route (QA R2 Manager N5).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
    if (!(await checkProjectAccess(session.user.id, projectId, ["VIEWER"])).allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const updates = await prisma.statusUpdate.findMany({
      where: { projectId },
      include: { author: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json(updates)
  } catch (error) {
    console.error("Error fetching project status updates:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
