export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlIncomeAccess, parsePnlDate, validAmount } from "@/lib/pnl"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ incomeId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { incomeId } = await params
    const gate = await checkPnlIncomeAccess(session.user.id, incomeId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json()
    const data: { title?: string; totalAmount?: number; stageId?: string | null; expectedDate?: Date | null; notes?: string | null } = {}

    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim()) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 })
      data.title = body.title.trim().slice(0, 200)
    }
    if (body.totalAmount !== undefined) {
      if (!validAmount(body.totalAmount) || body.totalAmount <= 0) return NextResponse.json({ error: "totalAmount must be a positive number" }, { status: 400 })
      data.totalAmount = body.totalAmount
    }
    if (body.stageId !== undefined) {
      if (body.stageId) {
        const stage = await prisma.pnlIncomeStage.findFirst({ where: { id: body.stageId, projectId: gate.income.projectId }, select: { id: true } })
        if (!stage) return NextResponse.json({ error: "Stage not found in this project" }, { status: 400 })
        data.stageId = body.stageId
      } else {
        data.stageId = null
      }
    }
    if (body.expectedDate !== undefined) {
      data.expectedDate = body.expectedDate ? parsePnlDate(body.expectedDate) : null
    }
    if (body.notes !== undefined) {
      data.notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : null
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 })

    const income = await prisma.pnlIncome.update({ where: { id: incomeId }, data, include: { payments: { orderBy: { date: "asc" } } } })

    logAudit({ action: "update", entityType: "pnl_income", entityId: incomeId, entityName: income.title, userId: session.user.id, request, metadata: { projectId: gate.income.projectId } })

    return NextResponse.json(income)
  } catch (error) {
    console.error("Error updating P&L income:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ incomeId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { incomeId } = await params
    const gate = await checkPnlIncomeAccess(session.user.id, incomeId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    await prisma.pnlIncome.delete({ where: { id: incomeId } })

    logAudit({ action: "delete", entityType: "pnl_income", entityId: incomeId, userId: session.user.id, request, metadata: { projectId: gate.income.projectId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting P&L income:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
