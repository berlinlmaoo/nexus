export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { findUnit, ORG_CHART_WORKSPACE, orgChartGuard } from "@/lib/org-chart"

async function isOrgMember(userId: string) {
  return Boolean(await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId: ORG_CHART_WORKSPACE } }, select: { id: true } }))
}

/** POST { userId, unitId } — adds a company member to one more IP/Team (idempotent). */
export async function POST(req: NextRequest) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  try {
    const body = await req.json().catch(() => ({}))
    const userId = typeof body?.userId === "string" ? body.userId : ""
    const unitId = typeof body?.unitId === "string" ? body.unitId : ""
    if (!userId || !unitId) return NextResponse.json({ error: "userId dan unitId wajib ada." }, { status: 400 })
    const unit = await findUnit(unitId)
    if (!unit) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    if (unit.kind === "GROUP") return NextResponse.json({ error: "Grup tidak berisi orang — taruh orangnya di kartu IP/Divisi di dalam grup." }, { status: 400 })
    if (!(await isOrgMember(userId))) return NextResponse.json({ error: "Orang ini bukan anggota Z Networks." }, { status: 404 })
    await prisma.orgUnitMember.upsert({
      where: { unitId_userId: { unitId, userId } },
      update: {},
      create: { unitId, userId, workspaceId: ORG_CHART_WORKSPACE },
    })
    return NextResponse.json({ ok: true, userId, unitId }, { status: 201 })
  } catch (error) {
    console.error("[admin/org-chart] POST member", error)
    return NextResponse.json({ error: "Gagal menambahkan." }, { status: 500 })
  }
}

/** DELETE ?userId=&unitId= — takes a person out of ONE IP/Team; their other units stay. */
export async function DELETE(req: NextRequest) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  try {
    const userId = req.nextUrl.searchParams.get("userId") ?? ""
    const unitId = req.nextUrl.searchParams.get("unitId") ?? ""
    if (!userId || !unitId) return NextResponse.json({ error: "userId dan unitId wajib ada." }, { status: 400 })
    if (!(await findUnit(unitId))) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    const r = await prisma.orgUnitMember.deleteMany({ where: { unitId, userId, workspaceId: ORG_CHART_WORKSPACE } })
    return NextResponse.json({ ok: true, removed: r.count })
  } catch (error) {
    console.error("[admin/org-chart] DELETE member", error)
    return NextResponse.json({ error: "Gagal melepas." }, { status: 500 })
  }
}

const LEADER_ROLES = ["BOD", "ONE_ABOVE_ALL", "MANAGER"]

/**
 * PATCH { userId, unitId, title?, reportsToUserId? } — on that card: the person's title ("CEO"; empty =
 * none) and/or who they sit under (a BoD/Manager of the SAME card; null = nobody).
 */
export async function PATCH(req: NextRequest) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  try {
    const body = await req.json().catch(() => ({}))
    const userId = typeof body?.userId === "string" ? body.userId : ""
    const unitId = typeof body?.unitId === "string" ? body.unitId : ""
    if (!userId || !unitId) return NextResponse.json({ error: "userId dan unitId wajib ada." }, { status: 400 })
    if (!("title" in body) && !("reportsToUserId" in body)) return NextResponse.json({ error: "Tidak ada yang diubah." }, { status: 400 })
    if (!(await findUnit(unitId))) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    const data: { title?: string | null; reportsToUserId?: string | null } = {}
    if ("title" in body) {
      if (body.title !== null && typeof body.title !== "string") return NextResponse.json({ error: "title harus teks atau null." }, { status: 400 })
      const raw = typeof body.title === "string" ? body.title.replace(/[\r\n\t]+/g, " ").trim() : ""
      if (raw.length > 40) return NextResponse.json({ error: "Jabatan maksimal 40 karakter." }, { status: 400 })
      data.title = raw || null
    }
    if ("reportsToUserId" in body) {
      const to = typeof body.reportsToUserId === "string" && body.reportsToUserId ? body.reportsToUserId : null
      if (to) {
        if (to === userId) return NextResponse.json({ error: "Tidak bisa di bawah dirinya sendiri." }, { status: 400 })
        const [inCard, lead, self] = await Promise.all([
          prisma.orgUnitMember.findUnique({ where: { unitId_userId: { unitId, userId: to } }, select: { id: true } }),
          prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: to, workspaceId: ORG_CHART_WORKSPACE } }, select: { role: true } }),
          prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId: ORG_CHART_WORKSPACE } }, select: { role: true } }),
        ])
        if (!inCard || !lead || !LEADER_ROLES.includes(lead.role)) return NextResponse.json({ error: "Atasannya harus BoD atau Manager di kartu yang sama." }, { status: 400 })
        if (self && (self.role === "BOD" || self.role === "ONE_ABOVE_ALL")) return NextResponse.json({ error: "BoD tidak ditaruh di bawah orang lain." }, { status: 400 })
      }
      data.reportsToUserId = to
    }
    const r = await prisma.orgUnitMember.updateMany({ where: { unitId, userId, workspaceId: ORG_CHART_WORKSPACE }, data })
    if (r.count === 0) return NextResponse.json({ error: "Orang ini belum ada di kartu itu." }, { status: 404 })
    return NextResponse.json({ ok: true, userId, unitId, ...data })
  } catch (error) {
    console.error("[admin/org-chart] PATCH member", error)
    return NextResponse.json({ error: "Gagal menyimpan." }, { status: 500 })
  }
}
