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
    if (!(await findUnit(unitId))) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
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

/** PATCH { userId, unitId, title } — the person's title on that card ("CEO"). Empty = none. */
export async function PATCH(req: NextRequest) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  try {
    const body = await req.json().catch(() => ({}))
    const userId = typeof body?.userId === "string" ? body.userId : ""
    const unitId = typeof body?.unitId === "string" ? body.unitId : ""
    if (!userId || !unitId) return NextResponse.json({ error: "userId dan unitId wajib ada." }, { status: 400 })
    if (body?.title !== null && typeof body?.title !== "string") return NextResponse.json({ error: "title harus teks atau null." }, { status: 400 })
    const raw = typeof body.title === "string" ? body.title.replace(/[\r\n\t]+/g, " ").trim() : ""
    if (raw.length > 40) return NextResponse.json({ error: "Jabatan maksimal 40 karakter." }, { status: 400 })
    if (!(await findUnit(unitId))) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    const r = await prisma.orgUnitMember.updateMany({ where: { unitId, userId, workspaceId: ORG_CHART_WORKSPACE }, data: { title: raw || null } })
    if (r.count === 0) return NextResponse.json({ error: "Orang ini belum ada di kartu itu." }, { status: 404 })
    return NextResponse.json({ ok: true, userId, unitId, title: raw || null })
  } catch (error) {
    console.error("[admin/org-chart] PATCH member", error)
    return NextResponse.json({ error: "Gagal menyimpan jabatan." }, { status: 500 })
  }
}
