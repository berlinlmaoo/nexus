export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { ensureProjectSheet } from "@/lib/project-sheets"

// GET /api/projects/[projectId]/sheets — the project's spreadsheets.
//
// Seeds the default sheet on the way through, which is how the ~70 projects that predate this
// feature get one without a backfill migration.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["VIEWER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    await ensureProjectSheet(projectId, session.user.id)

    const sheets = await prisma.projectSheet.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, position: true, _count: { select: { rows: true } } },
    })
    return NextResponse.json({
      sheets: sheets.map((s) => ({ id: s.id, name: s.name, position: s.position, rowCount: s._count.rows })),
    })
  } catch (error) {
    console.error("Error listing project sheets:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST — an extra sheet beyond the default. Handler ships now; the UI stays single-sheet for v1.
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = (await req.json().catch(() => ({}))) as { name?: unknown }
    const name = String(body?.name ?? "").trim().slice(0, 80) || "Sheet baru"

    const last = await prisma.projectSheet.findFirst({
      where: { projectId }, orderBy: { position: "desc" }, select: { position: true },
    })
    const sheet = await prisma.projectSheet.create({
      data: { projectId, name, position: (last?.position ?? -1) + 1, columns: [], createdById: session.user.id },
      select: { id: true, name: true, position: true },
    })
    return NextResponse.json(sheet, { status: 201 })
  } catch (error) {
    console.error("Error creating project sheet:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
