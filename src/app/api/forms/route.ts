export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { generateUniqueFormSlug } from "@/lib/form-slugs"
import { normalizeFormAccessSchedule } from "@/lib/form-access-schedule"
import { normalizeFormBranding, normalizeFormSettings } from "@/lib/form-settings"
import type { InputJsonValue } from "@prisma/client/runtime/client"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // `?projectIds=a,b,c` (web Forms page, perf pass 12 Oct 2026): the forms of several projects in one
    // request instead of one request per project (the page fanned out ~85 calls). Projects the caller
    // may not open are skipped silently, as the per-project fan-out's `.catch(() => [])` did. The answer
    // is the same flat array of forms; each carries its projectId. `?projectId=` is unchanged.
    const idsParam = request.nextUrl.searchParams.get("projectIds")
    const projectId = request.nextUrl.searchParams.get("projectId")
    let projectIds: string[]
    if (idsParam !== null) {
      const ids = Array.from(new Set(idsParam.split(",").map((x) => x.trim()).filter(Boolean))).slice(0, 300)
      projectIds = []
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10)
        const checks = await Promise.all(chunk.map((id) => checkProjectAccess(session.user!.id!, id, ["MEMBER"]).catch(() => ({ allowed: false }))))
        chunk.forEach((id, k) => { if (checks[k].allowed) projectIds.push(id) })
      }
      if (projectIds.length === 0) return NextResponse.json([])
    } else {
      if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
      const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
      if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      projectIds = [projectId]
    }

    const forms = await prisma.form.findMany({
      where: projectIds.length === 1 ? { projectId: projectIds[0] } : { projectId: { in: projectIds } },
      include: { _count: { select: { submissions: true } } },
      orderBy: { createdAt: "desc" },
    })

    const formsWithSlugs = await Promise.all(
      forms.map(async (form) => {
        if (form.slug) return form

        const slug = await generateUniqueFormSlug(prisma, form.name, form.id)
        return prisma.form.update({
          where: { id: form.id },
          data: { slug },
          include: { _count: { select: { submissions: true } } },
        })
      })
    )

    return NextResponse.json(formsWithSlugs)
  } catch (error) {
    console.error("Error fetching forms:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { name, description, fields, isPublic, requireAuth, projectId, accessSchedule, branding, settings } = await request.json()

    if (!name || !projectId || !fields) {
      return NextResponse.json({ error: "name, projectId, and fields are required" }, { status: 400 })
    }

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const slug = await generateUniqueFormSlug(prisma, name)
    const normalizedAccessSchedule = (normalizeFormAccessSchedule(accessSchedule) ?? undefined) as InputJsonValue | undefined

    const form = await prisma.form.create({
      data: {
        name,
        slug,
        description,
        fields,
        accessSchedule: normalizedAccessSchedule,
        branding: (normalizeFormBranding(branding) ?? undefined) as InputJsonValue | undefined,
        settings: (normalizeFormSettings(settings) ?? undefined) as InputJsonValue | undefined,
        isPublic: isPublic ?? false,
        requireAuth: requireAuth ?? false,
        projectId,
      },
      include: { _count: { select: { submissions: true } } },
    })

    logAudit({ action: "create", entityType: "form", entityId: form.id, entityName: name, userId: session.user.id, request })

    return NextResponse.json(form, { status: 201 })
  } catch (error) {
    console.error("Error creating form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
