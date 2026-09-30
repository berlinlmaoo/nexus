export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
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
    const data: { name?: string; kind?: string; parentId?: string | null; position?: number; logoUrl?: string | null; leadUserId?: string | null; layoutX?: number | null; layoutY?: number | null; boxLayout?: Prisma.InputJsonValue } = {}
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
    if ("leadUserId" in body) {
      // Must be a BoD/One Above All/Manager member of the PARENT unit (the chart draws the unit under them).
      const leadUserId = typeof body.leadUserId === "string" && body.leadUserId ? body.leadUserId : null
      if (leadUserId) {
        const parentId = "parentId" in data ? data.parentId : unit.parentId
        if (!parentId) return NextResponse.json({ error: "Kartu puncak tidak punya pemimpin dari induk." }, { status: 400 })
        const inParent = await prisma.orgUnitMember.findUnique({ where: { unitId_userId: { unitId: parentId, userId: leadUserId } }, select: { id: true } })
        const role = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: leadUserId, workspaceId: ORG_CHART_WORKSPACE } }, select: { role: true } })
        if (!inParent || !role || !["BOD", "ONE_ABOVE_ALL", "MANAGER"].includes(role.role)) {
          return NextResponse.json({ error: "Pemimpin harus BoD atau Manager di kartu induknya." }, { status: 400 })
        }
      }
      data.leadUserId = leadUserId
    }
    // Canvas position (owner, 30 Sep 2026). null = back to automatic.
    for (const k of ["layoutX", "layoutY"] as const) {
      if (!(k in body)) continue
      if (body[k] === null) data[k] = null
      else if (typeof body[k] === "number" && Number.isFinite(body[k]) && Math.abs(body[k]) <= 200000) data[k] = Math.round(body[k])
      else return NextResponse.json({ error: "Posisi tidak sah." }, { status: 400 })
    }
    if ("boxLayout" in body) {
      // A patch merged into what is stored: { key: {x,y} | null }. null removes that box's position.
      const patch = body.boxLayout
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return NextResponse.json({ error: "boxLayout tidak sah." }, { status: 400 })
      const cur = await prisma.orgUnit.findUnique({ where: { id: unitId }, select: { boxLayout: true } })
      const merged: Record<string, { x: number; y: number }> = { ...((cur?.boxLayout as Record<string, { x: number; y: number }> | null) ?? {}) }
      for (const [key, v] of Object.entries(patch as Record<string, unknown>)) {
        if (!/^(bod|manager|staff|rt:[A-Za-z0-9_-]{1,64})$/.test(key)) return NextResponse.json({ error: "Kotak tidak dikenal." }, { status: 400 })
        if (v === null) { delete merged[key]; continue }
        const o = v as { x?: unknown; y?: unknown }
        if (typeof o?.x !== "number" || typeof o?.y !== "number" || !Number.isFinite(o.x) || !Number.isFinite(o.y) || Math.abs(o.x) > 200000 || Math.abs(o.y) > 200000) {
          return NextResponse.json({ error: "Posisi kotak tidak sah." }, { status: 400 })
        }
        merged[key] = { x: Math.round(o.x), y: Math.round(o.y) }
      }
      if (Object.keys(merged).length > 64) return NextResponse.json({ error: "Terlalu banyak kotak." }, { status: 400 })
      data.boxLayout = merged
    }
    if ("kind" in body) {
      if (body.kind !== "IP" && body.kind !== "DIVISION") return NextResponse.json({ error: "Jenis harus IP atau Divisi." }, { status: 400 })
      data.kind = body.kind
    }
    if ("logoUrl" in body) {
      if (body.logoUrl === null) data.logoUrl = null
      else if (typeof body.logoUrl === "string" && body.logoUrl.startsWith(LOGO_PREFIX) && /^[\w./-]+$/.test(body.logoUrl) && !body.logoUrl.includes("..")) data.logoUrl = body.logoUrl
      else return NextResponse.json({ error: "Logo harus diunggah lewat bagan." }, { status: 400 })
    }
    const updated = await prisma.orgUnit.update({ where: { id: unitId }, data, select: { id: true, name: true, kind: true, logoUrl: true, parentId: true, position: true, leadUserId: true, layoutX: true, layoutY: true, boxLayout: true } })
    return NextResponse.json({ unit: updated })
  } catch (error) {
    console.error("[admin/org-chart] PATCH unit", error)
    return NextResponse.json({ error: "Gagal menyimpan." }, { status: 500 })
  }
}

/** DELETE — its sub-units move up to its parent; its memberships go with it (people stay in their other units). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ unitId: string }> }) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  const { unitId } = await params
  try {
    const unit = await findUnit(unitId)
    if (!unit) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    const [moved, released] = await prisma.$transaction([
      prisma.orgUnit.updateMany({ where: { workspaceId: ORG_CHART_WORKSPACE, parentId: unitId }, data: { parentId: unit.parentId } }),
      prisma.orgUnitMember.deleteMany({ where: { unitId } }),
      prisma.orgUnit.delete({ where: { id: unitId } }),
    ])
    return NextResponse.json({ ok: true, movedUp: moved.count, released: released.count })
  } catch (error) {
    console.error("[admin/org-chart] DELETE unit", error)
    return NextResponse.json({ error: "Gagal menghapus." }, { status: 500 })
  }
}
