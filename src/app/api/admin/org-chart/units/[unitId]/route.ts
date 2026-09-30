export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { cleanName, findUnit, ORG_CHART_WORKSPACE, orgChartGuard, wouldLoop } from "@/lib/org-chart"

const LOGO_PREFIX = "/api/files/attachments/org-units/"

/** PATCH { name?, parentId? (null = top), position?, logoUrl? (null removes; only our own uploads) } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ unitId: string }> }) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  const { unitId } = await params
  try {
    const unit = await findUnit(unitId)
    if (!unit) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const data: { name?: string; parentId?: string | null; position?: number; logoUrl?: string | null } = {}
    if ("name" in body) {
      const name = cleanName(body.name)
      if (!name) return NextResponse.json({ error: "Nama IP/Team wajib diisi." }, { status: 400 })
      data.name = name
    }
    if ("parentId" in body) {
      const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null
      if (parentId) {
        if (!(await findUnit(parentId))) return NextResponse.json({ error: "Induknya tidak ditemukan." }, { status: 400 })
        if (await wouldLoop(unitId, parentId)) return NextResponse.json({ error: "Tidak bisa ditaruh di dalam dirinya sendiri atau di bawah turunannya." }, { status: 400 })
      }
      data.parentId = parentId
    }
    if ("position" in body) {
      if (!Number.isInteger(body.position) || body.position < 0 || body.position > 100000) return NextResponse.json({ error: "Posisi tidak sah." }, { status: 400 })
      data.position = body.position
    }
    if ("logoUrl" in body) {
      if (body.logoUrl === null) data.logoUrl = null
      else if (typeof body.logoUrl === "string" && body.logoUrl.startsWith(LOGO_PREFIX) && /^[\w./-]+$/.test(body.logoUrl) && !body.logoUrl.includes("..")) data.logoUrl = body.logoUrl
      else return NextResponse.json({ error: "Logo harus diunggah lewat bagan." }, { status: 400 })
    }
    const updated = await prisma.orgUnit.update({ where: { id: unitId }, data, select: { id: true, name: true, logoUrl: true, parentId: true, position: true } })
    return NextResponse.json({ unit: updated })
  } catch (error) {
    console.error("[admin/org-chart] PATCH unit", error)
    return NextResponse.json({ error: "Gagal menyimpan." }, { status: 500 })
  }
}

/** DELETE — its sub-units move up to its parent; its people become "belum ditaruh". */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ unitId: string }> }) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  const { unitId } = await params
  try {
    const unit = await findUnit(unitId)
    if (!unit) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    const [moved, released] = await prisma.$transaction([
      prisma.orgUnit.updateMany({ where: { workspaceId: ORG_CHART_WORKSPACE, parentId: unitId }, data: { parentId: unit.parentId } }),
      prisma.workspaceMember.updateMany({ where: { workspaceId: ORG_CHART_WORKSPACE, orgUnitId: unitId }, data: { orgUnitId: null } }),
      prisma.orgUnit.delete({ where: { id: unitId } }),
    ])
    return NextResponse.json({ ok: true, movedUp: moved.count, released: released.count })
  } catch (error) {
    console.error("[admin/org-chart] DELETE unit", error)
    return NextResponse.json({ error: "Gagal menghapus." }, { status: 500 })
  }
}
