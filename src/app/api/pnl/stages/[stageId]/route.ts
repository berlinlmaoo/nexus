export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess } from "@/lib/pnl"

const HEX = /^#[0-9a-fA-F]{6}$/

async function gateStage(userId: string, stageId: string) {
  const stage = await prisma.pnlIncomeStage.findUnique({ where: { id: stageId }, select: { id: true, projectId: true } })
  if (!stage) return { ok: false as const, status: 404 as const, error: "Stage not found", stage: null }
  const gate = await checkPnlAccess(userId, stage.projectId)
  if (!gate.allowed) return { ok: false as const, status: gate.status, error: gate.error, stage: null }
  return { ok: true as const, status: 200 as const, error: null, stage }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ stageId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { stageId } = await params
    const gate = await gateStage(session.user.id, stageId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json()
    const data: { name?: string; color?: string; order?: number } = {}
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 })
      data.name = body.name.trim().slice(0, 60)
    }
    if (body.color !== undefined) {
      if (typeof body.color !== "string" || !HEX.test(body.color)) return NextResponse.json({ error: "color must be #rrggbb" }, { status: 400 })
      data.color = body.color
    }
    if (body.order !== undefined) {
      if (!Number.isInteger(body.order) || body.order < 0 || body.order > 9999) return NextResponse.json({ error: "Invalid order" }, { status: 400 })
      data.order = body.order
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 })

    const stage = await prisma.pnlIncomeStage.update({ where: { id: stageId }, data })

    logAudit({ action: "update", entityType: "pnl_stage", entityId: stageId, entityName: stage.name, userId: session.user.id, request })

    return NextResponse.json(stage)
  } catch (error) {
    console.error("Error updating P&L stage:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ stageId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { stageId } = await params
    const gate = await gateStage(session.user.id, stageId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    // Deals in this stage fall back to "tanpa stage" (stageId SetNull) — money data is untouched.
    await prisma.pnlIncomeStage.delete({ where: { id: stageId } })

    logAudit({ action: "delete", entityType: "pnl_stage", entityId: stageId, userId: session.user.id, request })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting P&L stage:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
