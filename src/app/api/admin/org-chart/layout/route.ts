export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { ORG_CHART_WORKSPACE, orgChartGuard } from "@/lib/org-chart"

/** POST { action: "reset" } — "Rapikan otomatis": every manual card and box position is dropped. */
export async function POST(req: NextRequest) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.action !== "reset") return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 })
    const r = await prisma.orgUnit.updateMany({
      where: { workspaceId: ORG_CHART_WORKSPACE },
      data: { layoutX: null, layoutY: null, boxLayout: Prisma.DbNull },
    })
    return NextResponse.json({ ok: true, reset: r.count })
  } catch (error) {
    console.error("[admin/org-chart] layout reset", error)
    return NextResponse.json({ error: "Gagal merapikan." }, { status: 500 })
  }
}
