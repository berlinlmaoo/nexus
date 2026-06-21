export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess } from "@/lib/pnl"

const HEX = /^#[0-9a-fA-F]{6}$/

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { projectId, name, color } = body ?? {}
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const gate = await checkPnlAccess(session.user.id, projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    if (typeof name !== "string" || !name.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 })

    const max = await prisma.pnlIncomeStage.aggregate({ where: { projectId }, _max: { order: true } })
    const stage = await prisma.pnlIncomeStage.create({
      data: {
        projectId,
        name: name.trim().slice(0, 60),
        color: typeof color === "string" && HEX.test(color) ? color : "#0091ff",
        order: (max._max.order ?? -1) + 1,
      },
    })

    logAudit({ action: "create", entityType: "pnl_stage", entityId: stage.id, entityName: stage.name, userId: session.user.id, request, metadata: { projectId } })

    return NextResponse.json(stage, { status: 201 })
  } catch (error) {
    console.error("Error creating P&L stage:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
