export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { cleanViewName, isViewLayout, sanitizeViewConfig, serializeView, ViewConfigError } from "@/lib/project-views"
import { notifyViewsChanged, viewAccess } from "@/lib/project-views-access"

type Params = { params: Promise<{ projectId: string; viewId: string }> }

/** The view if the caller can see it (shared, or their own personal one), and whether they may change it. */
async function load(userId: string, projectId: string, viewId: string) {
  const access = await viewAccess(userId, projectId)
  if (!access.read) return { status: 403 as const }
  const view = await prisma.projectView.findUnique({ where: { id: viewId } })
  if (!view || view.projectId !== projectId || (view.ownerId !== null && view.ownerId !== userId)) return { status: 404 as const }
  const canEdit = view.ownerId === null ? access.editShared : true
  return { status: 200 as const, view, access, canEdit }
}

/**
 * PATCH { name?, layout?, config?, patch?, shared? } → { view }
 *  - `config` replaces the whole config; `patch` merges top-level keys into it (two people changing
 *    different settings of one view at once do not undo each other).
 *  - `layout` cannot change on a built-in view (it stays the Board / List / … the apps know).
 *  - `shared` true turns a personal view into a shared one (needs MEMBER); false turns a shared custom
 *    view into the caller's personal one (needs MEMBER; built-ins always stay shared).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, viewId } = await params
    const found = await load(userId, projectId, viewId)
    if (found.status === 403) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (found.status === 404) return NextResponse.json({ error: "View not found" }, { status: 404 })
    const { view, access, canEdit } = found
    if (!canEdit) {
      return NextResponse.json({ error: "Only project members can change a view everyone shares. Save a personal copy instead.", code: "SHARED_VIEW_FORBIDDEN" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const data: Record<string, unknown> = {}
    if ("name" in body) data.name = cleanViewName(body.name)
    if (body.layout !== undefined && body.layout !== view.layout) {
      if (!isViewLayout(body.layout)) return NextResponse.json({ error: "Unknown layout", code: "INVALID_VIEW" }, { status: 400 })
      if (view.builtin) return NextResponse.json({ error: "A built-in view keeps its layout. Add a new view instead.", code: "BUILTIN_VIEW" }, { status: 400 })
      data.layout = body.layout
    }
    try {
      if (body.config !== undefined) data.config = sanitizeViewConfig(body.config)
      else if (body.patch !== undefined) {
        const current = view.config && typeof view.config === "object" && !Array.isArray(view.config) ? (view.config as Record<string, unknown>) : {}
        const patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch) ? (body.patch as Record<string, unknown>) : {}
        data.config = sanitizeViewConfig({ ...current, ...patch })
      }
    } catch (e) {
      if (e instanceof ViewConfigError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 })
      throw e
    }
    const wasShared = view.ownerId === null
    if (typeof body.shared === "boolean" && body.shared !== wasShared) {
      if (!access.editShared) {
        return NextResponse.json({ error: "Only project members can share a view with everyone.", code: "SHARED_VIEW_FORBIDDEN" }, { status: 403 })
      }
      if (view.builtin) return NextResponse.json({ error: "Built-in views are always shared.", code: "BUILTIN_VIEW" }, { status: 400 })
      data.ownerId = body.shared ? null : userId
    }
    const updated = Object.keys(data).length ? await prisma.projectView.update({ where: { id: viewId }, data }) : view
    const isShared = updated.ownerId === null
    notifyViewsChanged(projectId, userId, isShared || wasShared)
    return NextResponse.json({ view: serializeView(updated) })
  } catch (error) {
    console.error("Error updating project view:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** DELETE → { ok }. Built-in views are hidden through Project settings → Tabs instead (hiddenTabs). */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, viewId } = await params
    const found = await load(userId, projectId, viewId)
    if (found.status === 403) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (found.status === 404) return NextResponse.json({ error: "View not found" }, { status: 404 })
    const { view, canEdit } = found
    if (!canEdit) return NextResponse.json({ error: "Only project members can delete a view everyone shares.", code: "SHARED_VIEW_FORBIDDEN" }, { status: 403 })
    if (view.builtin) {
      return NextResponse.json({ error: "Built-in views can't be deleted. Hide it from Project settings → Tabs instead.", code: "BUILTIN_VIEW" }, { status: 400 })
    }
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
    // Kept first, so Control Room → Audit can restore it (owner, 8 Oct 2026: every delete is restorable).
    await restorableDelete({
      entityType: "project_view", entityId: viewId, entityName: view.name || view.layout,
      workspaceId: view.ownerId === null ? project?.workspaceId ?? null : null, userId, request,
      metadata: { projectId, layout: view.layout, shared: view.ownerId === null },
      meta: { open: { type: "project", id: projectId }, projectId },
      remove: (tx) => tx.projectView.delete({ where: { id: viewId } }),
    })
    notifyViewsChanged(projectId, userId, view.ownerId === null)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting project view:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
