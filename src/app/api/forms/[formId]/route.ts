export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { checkProjectAccess } from "@/lib/rbac"
import { generateUniqueFormSlug } from "@/lib/form-slugs"
import { normalizeFormAccessSchedule } from "@/lib/form-access-schedule"
import { normalizeFormBranding, normalizeFormSettings } from "@/lib/form-settings"
import { Prisma } from "@/generated/prisma/client"
import type { InputJsonValue } from "@prisma/client/runtime/client"

const jsonOrDbNull = (value: object | null) => (value ? (value as InputJsonValue) : Prisma.DbNull)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { formId } = await params

    const form = await prisma.form.findUnique({
      where: { id: formId },
      include: {
        submissions: { orderBy: { createdAt: "desc" } },
        _count: { select: { submissions: true } },
      },
    })

    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, form.projectId, ["VIEWER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    return NextResponse.json(form)
  } catch (error) {
    console.error("Error fetching form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { formId } = await params
    const body = await request.json()
    const { name, description, fields, isPublic, requireAuth, accessSchedule, branding, settings, baseUpdatedAt } = body

    const existing = await prisma.form.findUnique({
      where: { id: formId },
      select: { id: true, name: true, slug: true, projectId: true },
    })

    if (!existing) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, existing.projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const slug = existing.slug ?? await generateUniqueFormSlug(prisma, name ?? existing.name, existing.id)

    const normalizedAccessSchedule = (normalizeFormAccessSchedule(accessSchedule) ?? undefined) as InputJsonValue | undefined

    const data = {
      ...(name !== undefined && { name }),
      ...(!existing.slug && { slug }),
      ...(description !== undefined && { description }),
      ...(fields !== undefined && { fields }),
      ...(accessSchedule !== undefined && { accessSchedule: normalizedAccessSchedule }),
      ...(isPublic !== undefined && { isPublic }),
      ...(requireAuth !== undefined && { requireAuth }),
      // Builder rebuild (12 Oct 2026): the page's icon/cover and the response settings. Absent = unchanged
      // (released apps never send them); null or an empty object clears them.
      ...(branding !== undefined && { branding: jsonOrDbNull(normalizeFormBranding(branding)) }),
      ...(settings !== undefined && { settings: jsonOrDbNull(normalizeFormSettings(settings)) }),
    }

    // Compare-and-swap on updatedAt (race audit 16 Oct 2026, H7). The builder autosaves the whole form every
    // 700 ms; two people (or two tabs) editing one form each sent their copy and the last one silently undid the
    // other's questions — 20 saves from one copy: 20 × 200, 19 edits lost. `baseUpdatedAt` = the updatedAt of the
    // form the client last saw (load or its own last save): the write lands only if nobody saved since, else
    // 409 FORM_CHANGED with the form as it is now, nothing written. The web sends only the keys it changed, so
    // it can re-apply them on the new copy. Without a base (released apps): as before.
    let form
    if (baseUpdatedAt !== undefined) {
      const base = typeof baseUpdatedAt === "string" ? new Date(baseUpdatedAt) : null
      if (!base || Number.isNaN(base.getTime())) return NextResponse.json({ error: "baseUpdatedAt must be an ISO date", code: "INVALID_BASE" }, { status: 400 })
      const claimed = await prisma.form.updateMany({ where: { id: formId, updatedAt: base }, data })
      if (claimed.count === 0) {
        const current = await prisma.form.findUnique({ where: { id: formId } })
        return NextResponse.json(
          { error: "This form was changed by someone else. Your last change was not saved.", code: "FORM_CHANGED", conflict: true, form: current },
          { status: 409 },
        )
      }
      form = await prisma.form.findUniqueOrThrow({ where: { id: formId } })
    } else {
      form = await prisma.form.update({ where: { id: formId }, data })
    }

    logAudit({ action: "update", entityType: "form", entityId: formId, entityName: form.name, userId: session.user.id, request, metadata: { changes: Object.keys(body).filter((k) => k !== "baseUpdatedAt") } })

    return NextResponse.json(form)
  } catch (error) {
    console.error("Error updating form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { formId } = await params
    const search = new URL(request.url).searchParams
    const force = search.get("force") === "1"
    // expect = the response count the person confirmed (web, 12 Oct 2026). More than that arrived since:
    // ask again instead of deleting responses nobody saw. Without it (released apps): force=1 as before.
    const expectRaw = search.get("expect")
    const expected = expectRaw !== null && /^\d+$/.test(expectRaw) ? Number(expectRaw) : null

    const existing = await prisma.form.findUnique({
      where: { id: formId },
      select: { projectId: true, name: true, project: { select: { workspaceId: true } }, _count: { select: { submissions: true } } },
    })

    if (!existing) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, existing.projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Guard: deleting a form CASCADE-deletes every submission (and its "Pengajuan Saya" history) — that
    // bit a user before. Refuse unless the caller explicitly confirms with ?force=1 after seeing the count.
    const submissionCount = existing._count.submissions
    if ((!force && submissionCount > 0) || (force && expected !== null && submissionCount > expected)) {
      return NextResponse.json(
        { error: `Form ini punya ${submissionCount} pengajuan — kalau dihapus, semua pengajuan + history-nya ikut kehapus permanen.`, submissionCount },
        { status: 409 }
      )
    }

    // Kept with its submissions first, so Control Room → Audit can restore it (the force=1 guard
    // above still asks first: a restore is a way back, not a reason to delete without looking).
    await restorableDelete({
      entityType: "form", entityId: formId, entityName: existing.name, workspaceId: existing.project.workspaceId,
      userId: session.user.id, request, metadata: { submissionCount, projectId: existing.projectId },
      meta: { open: { type: "form", id: formId, projectId: existing.projectId }, projectId: existing.projectId },
      remove: (tx) => tx.form.delete({ where: { id: formId } }),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
