export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { setAppSetting } from "@/lib/app-setting"
import { isAdminOrOrgBodPlus, ORG_WORKSPACE_ID } from "@/lib/org"
import { normalizeCalendarSettings, privacyOf, type CalendarSettings } from "@/lib/calendar/core"
import { CALENDAR_SETTING_KEY, getCalendarSettings, loadProjectUnits, loadStructure } from "@/lib/calendar/server"

/**
 * GET/PATCH /api/admin/calendar-settings — the Calendar's AppSetting "calendar": which projects are
 * private (staff outside them see "Tugas internal", decision 1), which division a project or folder
 * belongs to (for tasks none of whose PICs is in the Bagan, decision 4), the rollout audience and the
 * overdue window. BoD / One Above All / system admin only. Takes effect on the next request, no deploy.
 */

async function guard(): Promise<NextResponse | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await isAdminOrOrgBodPlus(userId))) return NextResponse.json({ error: "Hanya BoD / One Above All yang bisa mengatur kalender." }, { status: 403 })
  return null
}

async function payload(settings: CalendarSettings) {
  const [projects, folders, s] = await Promise.all([
    prisma.project.findMany({
      where: { workspaceId: ORG_WORKSPACE_ID, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, color: true, folderId: true },
      orderBy: { name: "asc" },
    }),
    prisma.projectFolder.findMany({ where: { workspaceId: ORG_WORKSPACE_ID }, select: { id: true, name: true, parentFolderId: true }, orderBy: { name: "asc" } }),
    loadStructure(),
  ])
  const division = await loadProjectUnits(s, settings)
  return {
    settings,
    units: s.units.filter((u) => u.kind !== "GROUP").map((u) => ({ id: u.id, name: u.name, depth: u.depth })),
    folders: folders.map((f) => ({ ...f, unitId: settings.folderUnits[f.id] ?? null })),
    projects: projects.map((p) => ({
      ...p,
      private: privacyOf(settings, p) !== null,
      privateBy: privacyOf(settings, p),
      unitId: division.get(p.id)?.unitId ?? null,
      unitBy: division.get(p.id)?.why ?? null,
    })),
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
    // Division mapping: a key may be a folder/project that has since gone (dropped quietly); a value
    // must be a card of the Bagan (not a group).
    const [folderIds, projectIds, cardIds] = await Promise.all([
      prisma.projectFolder.findMany({ where: { workspaceId: ORG_WORKSPACE_ID, id: { in: Object.keys(next.folderUnits) } }, select: { id: true } }),
      prisma.project.findMany({ where: { workspaceId: ORG_WORKSPACE_ID, id: { in: Object.keys(next.projectUnits) } }, select: { id: true } }),
      prisma.orgUnit.findMany({ where: { workspaceId: ORG_WORKSPACE_ID, kind: { not: "GROUP" } }, select: { id: true } }),
    ])
    const cards = new Set(cardIds.map((u) => u.id))
    const badUnit = [...Object.values(next.folderUnits), ...Object.values(next.projectUnits)].find((u) => !cards.has(u))
    if (badUnit) return NextResponse.json({ error: "Divisi tujuan harus kartu di Bagan (bukan grup)." }, { status: 400 })
    const keepKeys = (m: Record<string, string>, ok: Set<string>) => Object.fromEntries(Object.entries(m).filter(([k]) => ok.has(k)))
    next = {
      ...next,
      folderUnits: keepKeys(next.folderUnits, new Set(folderIds.map((f) => f.id))),
      projectUnits: keepKeys(next.projectUnits, new Set(projectIds.map((p) => p.id))),
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
