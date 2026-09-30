export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { cleanName, findUnit, ORG_CHART_WORKSPACE, orgChartGuard } from "@/lib/org-chart"

/**
 * Bagan IP & Divisi — every unit and every member of the company workspace in one call. The client
 * builds the tree (free depth, parentId) and puts people under each of their units (unitIds).
 */
export async function GET() {
  const g = await orgChartGuard("read")
  if (g instanceof NextResponse) return g
  try {
    const [units, rows, links] = await Promise.all([
      prisma.orgUnit.findMany({
        where: { workspaceId: ORG_CHART_WORKSPACE },
        select: { id: true, name: true, kind: true, logoUrl: true, parentId: true, position: true, leadUserId: true, layoutX: true, layoutY: true, boxLayout: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId: ORG_CHART_WORKSPACE, user: { email: { not: "gideon@znetworks.id" } } },
        select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
        orderBy: { user: { name: "asc" } },
      }),
      prisma.orgUnitMember.findMany({ where: { workspaceId: ORG_CHART_WORKSPACE }, select: { unitId: true, userId: true, title: true, reportsToUserId: true }, orderBy: { createdAt: "asc" } }),
    ])
    const ids = new Set(units.map((u) => u.id))
    const unitsOf = new Map<string, string[]>()
    const titlesOf = new Map<string, Record<string, string>>()
    const reportsOf = new Map<string, Record<string, string>>()
    for (const l of links) {
      if (!ids.has(l.unitId)) continue
      unitsOf.set(l.userId, [...(unitsOf.get(l.userId) ?? []), l.unitId])
      if (l.title) titlesOf.set(l.userId, { ...(titlesOf.get(l.userId) ?? {}), [l.unitId]: l.title })
      if (l.reportsToUserId) reportsOf.set(l.userId, { ...(reportsOf.get(l.userId) ?? {}), [l.unitId]: l.reportsToUserId })
    }
    const people = rows.map((r) => ({
      userId: r.user.id, name: r.user.name, email: r.user.email, avatar: r.user.avatar, role: r.role,
      unitIds: unitsOf.get(r.user.id) ?? [],
      /** Jabatan per kartu: { [unitId]: "CEO" }. */
      titles: titlesOf.get(r.user.id) ?? {},
      /** Di bawah siapa per kartu: { [unitId]: leaderUserId }. */
      reportsTo: reportsOf.get(r.user.id) ?? {},
    }))
    return NextResponse.json({
      workspaceId: ORG_CHART_WORKSPACE,
      units: units.map((u) => ({ ...u, parentId: u.parentId && ids.has(u.parentId) ? u.parentId : null })),
      people,
      stats: { units: units.length, people: people.length, placed: people.filter((p) => p.unitIds.length > 0).length },
    })
  } catch (error) {
    console.error("[admin/org-chart] GET", error)
    return NextResponse.json({ error: "Bagan tidak bisa dimuat." }, { status: 500 })
  }
}

/** POST { name, parentId? } → 201 { unit } */
export async function POST(req: NextRequest) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  try {
    const body = await req.json().catch(() => ({}))
    const name = cleanName(body?.name)
    if (!name) return NextResponse.json({ error: "Nama IP/Team wajib diisi." }, { status: 400 })
    let parentId: string | null = null
    if (typeof body?.parentId === "string" && body.parentId) {
      if (!(await findUnit(body.parentId))) return NextResponse.json({ error: "Induknya tidak ditemukan." }, { status: 400 })
      parentId = body.parentId
    }
    const last = await prisma.orgUnit.aggregate({ where: { workspaceId: ORG_CHART_WORKSPACE, parentId }, _max: { position: true } })
    const unit = await prisma.orgUnit.create({
      data: { workspaceId: ORG_CHART_WORKSPACE, name, parentId, kind: body?.kind === "IP" ? "IP" : "DIVISION", position: (last._max.position ?? -1) + 1 },
      select: { id: true, name: true, kind: true, logoUrl: true, parentId: true, position: true },
    })
    return NextResponse.json({ unit }, { status: 201 })
  } catch (error) {
    console.error("[admin/org-chart] POST", error)
    return NextResponse.json({ error: "Gagal menambah IP/Team." }, { status: 500 })
  }
}
