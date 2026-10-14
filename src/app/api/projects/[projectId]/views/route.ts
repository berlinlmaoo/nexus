export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  cleanViewName,
  ensureBuiltinViews,
  isViewLayout,
  MAX_VIEWS_PER_PROJECT,
  sanitizeViewConfig,
  serializeView,
  ViewConfigError,
} from "@/lib/project-views"
import { notifyViewsChanged, viewAccess } from "@/lib/project-views-access"

/**
 * Saved views of a project (owner, 12 Oct 2026). Rules in src/lib/project-views.ts.
 *
 * GET   → { views, canEditShared }  the project's shared views plus the caller's personal ones, in tab
 *         order. The five built-in views are created here on the first read of a task project.
 * POST  { name, layout, shared?, config? } → { view }   personal by default; shared needs MEMBER.
 * PATCH { order: viewId[] } → { views }                 tab order; only views the caller may edit move.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const access = await viewAccess(session.user.id, projectId)
    if (!access.read) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { type: true, tableColumns: true, templateId: true, customFields: { select: { id: true, name: true, type: true } }, taskLists: { select: { name: true } } },
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const where = { projectId, OR: [{ ownerId: null }, { ownerId: session.user.id }] }
    let rows = await prisma.projectView.findMany({ where, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })
    // Pipeline, Outlet Sales and Social Media Report projects have their own screens; only task projects
    // get the built-ins.
    if (project.type !== "PIPELINE" && project.type !== "OUTLET_SALES" && project.type !== "SOCIAL_MEDIA_REPORT") {
      const have = new Set(rows.filter((r) => r.builtin && r.ownerId === null).map((r) => r.builtin as string))
      const seed = { id: projectId, tableColumns: project.tableColumns, templateId: project.templateId, customFields: project.customFields.map((f) => ({ ...f, type: String(f.type) })), sectionNames: project.taskLists.map((l) => l.name) }
      if (await ensureBuiltinViews(prisma, seed, have)) {
        rows = await prisma.projectView.findMany({ where, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })
      }
    }
    return NextResponse.json({ views: rows.map(serializeView), canEditShared: access.editShared })
  } catch (error) {
    console.error("Error listing project views:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId } = await params
    const access = await viewAccess(userId, projectId)
    if (!access.editPersonal) return NextResponse.json({ error: "Forbidden: you need Can edit access in this project", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!isViewLayout(body.layout)) return NextResponse.json({ error: "Unknown layout", code: "INVALID_VIEW" }, { status: 400 })
    const shared = body.shared === true
    if (shared && !access.editShared) {
      return NextResponse.json({ error: "Only project members can add a view for everyone. Make it a personal view instead.", code: "SHARED_VIEW_FORBIDDEN" }, { status: 403 })
    }
    const count = await prisma.projectView.count({ where: { projectId } })
    if (count >= MAX_VIEWS_PER_PROJECT) {
      return NextResponse.json({ error: "This project already has the most views it can hold. Delete one first.", code: "TOO_MANY_VIEWS" }, { status: 400 })
    }
    let config: Record<string, unknown>
    try {
      config = sanitizeViewConfig(body.config)
    } catch (e) {
      if (e instanceof ViewConfigError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 })
      throw e
    }
    const last = await prisma.projectView.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } })
    const view = await prisma.projectView.create({
      data: {
        projectId,
        name: cleanViewName(body.name),
        layout: body.layout,
        builtin: null,
        position: (last?.position ?? -1) + 1,
        config: config as object,
        ownerId: shared ? null : userId,
        createdById: userId,
      },
    })
    notifyViewsChanged(projectId, userId, view.ownerId === null)
    return NextResponse.json({ view: serializeView(view) }, { status: 201 })
  } catch (error) {
    console.error("Error creating project view:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId } = await params
    const access = await viewAccess(userId, projectId)
    if (!access.editPersonal) return NextResponse.json({ error: "Forbidden: you need Can edit access in this project", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })

    const body = (await request.json().catch(() => ({}))) as { order?: unknown }
    const order = Array.isArray(body.order) ? body.order.filter((x): x is string => typeof x === "string").slice(0, MAX_VIEWS_PER_PROJECT) : null
    if (!order?.length) return NextResponse.json({ error: "order is required" }, { status: 400 })

    const rows = await prisma.projectView.findMany({ where: { projectId, OR: [{ ownerId: null }, { ownerId: userId }] } })
    const byId = new Map(rows.map((r) => [r.id, r]))
    let touchedShared = false
    await prisma.$transaction(
      order.flatMap((id, index) => {
        const row = byId.get(id)
        if (!row || row.position === index) return []
        if (row.ownerId === null && !access.editShared) return []
        if (row.ownerId === null) touchedShared = true
        return [prisma.projectView.update({ where: { id }, data: { position: index } })]
      }),
    )
    notifyViewsChanged(projectId, userId, touchedShared)
    const fresh = await prisma.projectView.findMany({
      where: { projectId, OR: [{ ownerId: null }, { ownerId: userId }] },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    })
    return NextResponse.json({ views: fresh.map(serializeView) })
  } catch (error) {
    console.error("Error reordering project views:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
