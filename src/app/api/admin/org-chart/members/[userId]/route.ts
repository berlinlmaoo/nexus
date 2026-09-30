export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { findUnit, ORG_CHART_WORKSPACE, orgChartGuard } from "@/lib/org-chart"

/** PATCH { orgUnitId: string | null } — puts a company member in one IP/Team (or takes them out). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  const { userId } = await params
  try {
    const body = await req.json().catch(() => ({}))
    if (!("orgUnitId" in body)) return NextResponse.json({ error: "orgUnitId wajib ada (null = lepas)." }, { status: 400 })
    const orgUnitId = typeof body.orgUnitId === "string" && body.orgUnitId ? body.orgUnitId : null
    if (orgUnitId && !(await findUnit(orgUnitId))) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 400 })
    const member = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId: ORG_CHART_WORKSPACE } }, select: { id: true } })
    if (!member) return NextResponse.json({ error: "Orang ini bukan anggota Z Networks." }, { status: 404 })
    await prisma.workspaceMember.update({ where: { id: member.id }, data: { orgUnitId } })
    return NextResponse.json({ ok: true, userId, orgUnitId })
  } catch (error) {
    console.error("[admin/org-chart] PATCH member", error)
    return NextResponse.json({ error: "Gagal memindahkan." }, { status: 500 })
  }
}
