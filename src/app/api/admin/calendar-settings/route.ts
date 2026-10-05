export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { setAppSetting } from "@/lib/app-setting"
import { isAdminOrOrgBodPlus, ORG_WORKSPACE_ID } from "@/lib/org"
import { normalizeCalendarSettings, privacyOf, type CalendarSettings } from "@/lib/calendar/core"
import { CALENDAR_SETTING_KEY, getCalendarSettings } from "@/lib/calendar/server"

/**
 * GET/PATCH /api/admin/calendar-settings — the Calendar's AppSetting "calendar": which projects are
 * private (staff outside them see "Tugas internal", decision 1), the rollout audience and the overdue
 * window. BoD / One Above All / system admin only. Takes effect on the next request, no deploy.
 */

async function guard(): Promise<NextResponse | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await isAdminOrOrgBodPlus(userId))) return NextResponse.json({ error: "Hanya BoD / One Above All yang bisa mengatur kalender." }, { status: 403 })
  return null
}

async function payload(settings: CalendarSettings) {
  const projects = await prisma.project.findMany({
    where: { workspaceId: ORG_WORKSPACE_ID, status: { not: "ARCHIVED" } },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  })
  return {
    settings,
    projects: projects.map((p) => ({ ...p, private: privacyOf(settings, p) !== null, privateBy: privacyOf(settings, p) })),
  }
}

export async function GET() {
  const denied = await guard()
  if (denied) return denied
  try {
    return NextResponse.json(await payload(await getCalendarSettings()), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    console.error("[admin/calendar-settings] GET", error)
    return NextResponse.json({ error: "Pengaturan kalender tidak bisa dimuat." }, { status: 500 })
  }
}

/**
 * PATCH with any of the settings fields; the rest stay. `privateProjectIds` / `notPrivateProjectIds`
 * must be projects of the company workspace. Convenience: { projectId, private: true|false } flips one
 * project (what the Control Room toggle sends).
 */
export async function PATCH(req: NextRequest) {
  const denied = await guard()
  if (denied) return denied
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Isi permintaan tidak valid." }, { status: 400 })
    const current = await getCalendarSettings()
    let next = normalizeCalendarSettings(body, current)

    if (typeof body.projectId === "string" && typeof body.private === "boolean") {
      const project = await prisma.project.findFirst({ where: { id: body.projectId, workspaceId: ORG_WORKSPACE_ID }, select: { id: true, name: true } })
      if (!project) return NextResponse.json({ error: "Proyek tidak ditemukan." }, { status: 404 })
      const priv = new Set(next.privateProjectIds)
      const notPriv = new Set(next.notPrivateProjectIds)
      priv.delete(project.id)
      notPriv.delete(project.id)
      const byName = privacyOf({ ...next, privateProjectIds: [], notPrivateProjectIds: [] }, project) !== null
      if (body.private && !byName) priv.add(project.id)
      if (!body.private && byName) notPriv.add(project.id)
      next = { ...next, privateProjectIds: [...priv], notPrivateProjectIds: [...notPriv] }
    }

    // Only ids this request ADDS must exist; ids already stored that have since gone (a deleted
    // project, a tester who left) are dropped quietly, so one stale id never blocks every later change.
    const before = new Set([...current.privateProjectIds, ...current.notPrivateProjectIds, ...current.audienceUserIds])
    const listed = Array.from(new Set([...next.privateProjectIds, ...next.notPrivateProjectIds]))
    const okProjects = new Set(listed.length === 0 ? [] : (await prisma.project.findMany({ where: { id: { in: listed }, workspaceId: ORG_WORKSPACE_ID }, select: { id: true } })).map((p) => p.id))
    if (listed.some((id) => !okProjects.has(id) && !before.has(id))) return NextResponse.json({ error: "Ada proyek yang bukan milik workspace perusahaan." }, { status: 400 })
    const okUsers = new Set(next.audienceUserIds.length === 0 ? [] : (await prisma.workspaceMember.findMany({ where: { workspaceId: ORG_WORKSPACE_ID, userId: { in: next.audienceUserIds } }, select: { userId: true } })).map((m) => m.userId))
    if (next.audienceUserIds.some((id) => !okUsers.has(id) && !before.has(id))) return NextResponse.json({ error: "Ada penguji yang bukan anggota workspace perusahaan." }, { status: 400 })
    next = {
      ...next,
      privateProjectIds: next.privateProjectIds.filter((id) => okProjects.has(id)),
      notPrivateProjectIds: next.notPrivateProjectIds.filter((id) => okProjects.has(id)),
      audienceUserIds: next.audienceUserIds.filter((id) => okUsers.has(id)),
    }
    await setAppSetting(CALENDAR_SETTING_KEY, next)
    return NextResponse.json(await payload(next))
  } catch (error) {
    console.error("[admin/calendar-settings] PATCH", error)
    return NextResponse.json({ error: "Pengaturan kalender gagal disimpan." }, { status: 500 })
  }
}
