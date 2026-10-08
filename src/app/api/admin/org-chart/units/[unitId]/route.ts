export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { cleanName, descendantIds, effectiveParentId, findUnit, insideGroup, isUnitKind, ORG_CHART_WORKSPACE, orgChartGuard, wouldLoop } from "@/lib/org-chart"
import { restorableDelete } from "@/lib/deletion-snapshot"

const LOGO_PREFIX = "/api/files/attachments/org-units/"

/**
 * PATCH { name?, kind?, parentId? (null = top), position?, logoUrl? (null removes; only our own uploads),
 *         leadUserId?, layoutX?, layoutY?, boxLayout? (merge patch; null = clear all) }
 *
 * Groups (kind "GROUP", owner 2 Oct 2026) only arrange cards: no logo, no people, no lead of their own.
 * A card inside a group is led from the card ABOVE the group, and is laid out automatically inside it,
 * so moving a card into a group (or turning a card into a group) drops the manual positions below.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ unitId: string }> }) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  const { unitId } = await params
  try {
    const unit = await findUnit(unitId)
    if (!unit) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const data: Prisma.OrgUnitUncheckedUpdateInput = {}

    if ("kind" in body && !isUnitKind(body.kind)) return NextResponse.json({ error: "Jenis harus IP, Divisi, atau Grup." }, { status: 400 })
    const nextKind: string = "kind" in body ? body.kind : unit.kind
    const becomesGroup = nextKind === "GROUP" && unit.kind !== "GROUP"
    if ("kind" in body) data.kind = nextKind
    if (becomesGroup) {
      const people = await prisma.orgUnitMember.count({ where: { unitId } })
      if (people > 0) {
        return NextResponse.json({ error: `Kartu ini masih berisi ${people} orang. Lepas orangnya dulu sebelum dijadikan Grup.` }, { status: 400 })
      }
      data.leadUserId = null
    }

    if ("name" in body) {
      const name = cleanName(body.name)
      if (!name) return NextResponse.json({ error: "Nama IP/Team wajib diisi." }, { status: 400 })
      data.name = name
    }
    let nextParentId: string | null = unit.parentId
    if ("parentId" in body) {
      const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null
      if (parentId) {
        if (!(await findUnit(parentId))) return NextResponse.json({ error: "Induknya tidak ditemukan." }, { status: 400 })
        if (await wouldLoop(unitId, parentId)) return NextResponse.json({ error: "Tidak bisa ditaruh di dalam dirinya sendiri atau di bawah turunannya." }, { status: 400 })
      }
      data.parentId = parentId
      nextParentId = parentId
    }
    if ("position" in body) {
      if (!Number.isInteger(body.position) || body.position < 0 || body.position > 100000) return NextResponse.json({ error: "Posisi tidak sah." }, { status: 400 })
      data.position = body.position
    }
    if ("leadUserId" in body) {
      const leadUserId = typeof body.leadUserId === "string" && body.leadUserId ? body.leadUserId : null
      if (leadUserId) {
        if (nextKind === "GROUP") return NextResponse.json({ error: "Grup tidak punya pemimpin." }, { status: 400 })
        // A BoD/One Above All/Manager of the card above: the parent, or the card above its group(s).
        const leadCard = await effectiveParentId(nextParentId)
        if (!leadCard) return NextResponse.json({ error: "Kartu puncak tidak punya pemimpin dari induk." }, { status: 400 })
        const inParent = await prisma.orgUnitMember.findUnique({ where: { unitId_userId: { unitId: leadCard, userId: leadUserId } }, select: { id: true } })
        const role = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: leadUserId, workspaceId: ORG_CHART_WORKSPACE } }, select: { role: true } })
        if (!inParent || !role || !["BOD", "ONE_ABOVE_ALL", "MANAGER"].includes(role.role)) {
          return NextResponse.json({ error: "Pemimpin harus BoD atau Manager di kartu induknya (untuk kartu di dalam grup: kartu di atas grup itu)." }, { status: 400 })
        }
      }
      if (!becomesGroup) data.leadUserId = leadUserId
    }
    // Canvas position (owner, 30 Sep 2026). null = back to automatic.
    for (const k of ["layoutX", "layoutY"] as const) {
      if (!(k in body)) continue
      if (body[k] === null) data[k] = null
      else if (typeof body[k] === "number" && Number.isFinite(body[k]) && Math.abs(body[k]) <= 200000) data[k] = Math.round(body[k])
      else return NextResponse.json({ error: "Posisi tidak sah." }, { status: 400 })
    }
    if ("boxLayout" in body) {
      // A patch merged into what is stored: { key: {x,y} | null }. null removes that box's position;
      // boxLayout: null clears them all.
      const patch = body.boxLayout
      if (patch === null) data.boxLayout = Prisma.DbNull
      else {
        if (typeof patch !== "object" || Array.isArray(patch)) return NextResponse.json({ error: "boxLayout tidak sah." }, { status: 400 })
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
    }
    if ("logoUrl" in body) {
      if (body.logoUrl === null) data.logoUrl = null
      else if (nextKind === "GROUP") return NextResponse.json({ error: "Grup tidak memakai logo." }, { status: 400 })
      else if (typeof body.logoUrl === "string" && body.logoUrl.startsWith(LOGO_PREFIX) && /^[\w./-]+$/.test(body.logoUrl) && !body.logoUrl.includes("..")) data.logoUrl = body.logoUrl
      else return NextResponse.json({ error: "Logo harus diunggah lewat bagan." }, { status: 400 })
    }

    // Laid out automatically from now on: a card moved into a group (with everything below it), or
    // everything below a card that just became a group.
    const movedIntoGroup = "parentId" in body && nextParentId !== unit.parentId && (await insideGroup(nextParentId))
    const below = movedIntoGroup || becomesGroup ? await descendantIds(unitId) : []
    if (movedIntoGroup) { data.layoutX = null; data.layoutY = null; data.boxLayout = Prisma.DbNull }
    const [, updated] = await prisma.$transaction([
      prisma.orgUnit.updateMany({ where: { id: { in: below }, workspaceId: ORG_CHART_WORKSPACE }, data: { layoutX: null, layoutY: null, boxLayout: Prisma.DbNull } }),
      prisma.orgUnit.update({ where: { id: unitId }, data, select: { id: true, name: true, kind: true, logoUrl: true, parentId: true, position: true, leadUserId: true, layoutX: true, layoutY: true, boxLayout: true } }),
    ])
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
    // Child units move up to this unit's parent and its people leave the card, as before — one
    // transaction, after keeping the unit, its people and where each child unit was: Control Room →
    // Audit restores the card with its people and moves the child units back under it (unless they
    // have been moved since). In the audit since 8 Oct 2026.
    let movedUp = 0
    const released = await prisma.orgUnitMember.count({ where: { unitId } })
    await restorableDelete({
      entityType: "org_unit", entityId: unitId, entityName: unit.name, workspaceId: ORG_CHART_WORKSPACE,
      userId: g.userId, request: _req, metadata: { kind: unit.kind, parentId: unit.parentId, people: released },
      meta: { open: { type: "org_chart", id: unitId } },
      before: async (tx) => {
        const children = await tx.orgUnit.findMany({ where: { workspaceId: ORG_CHART_WORKSPACE, parentId: unitId }, select: { id: true } })
        await tx.orgUnit.updateMany({ where: { workspaceId: ORG_CHART_WORKSPACE, parentId: unitId }, data: { parentId: unit.parentId } })
        movedUp = children.length
        return children.map((c) => ({ table: "OrgUnit", column: "parentId", key: c.id, value: unitId, movedTo: unit.parentId }))
      },
      // The unit's OrgUnitMember rows cascade with it (and are in the copy).
      remove: (tx) => tx.orgUnit.delete({ where: { id: unitId } }),
    })
    return NextResponse.json({ ok: true, movedUp, released })
  } catch (error) {
    console.error("[admin/org-chart] DELETE unit", error)
    return NextResponse.json({ error: "Gagal menghapus." }, { status: 500 })
  }
}
