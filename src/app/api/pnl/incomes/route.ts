export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess, parsePnlDate, validAmount } from "@/lib/pnl"

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { projectId, title, totalAmount, stageId, expectedDate, notes } = body ?? {}
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const gate = await checkPnlAccess(session.user.id, projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    if (typeof title !== "string" || !title.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 })
    if (!validAmount(totalAmount) || totalAmount <= 0) return NextResponse.json({ error: "totalAmount must be a positive number" }, { status: 400 })

    if (stageId) {
      const stage = await prisma.pnlIncomeStage.findFirst({ where: { id: stageId, projectId }, select: { id: true } })
      if (!stage) return NextResponse.json({ error: "Stage not found in this project" }, { status: 400 })
    }

    const income = await prisma.pnlIncome.create({
      data: {
        projectId,
        title: title.trim().slice(0, 200),
        totalAmount,
        stageId: stageId || null,
        expectedDate: expectedDate ? parsePnlDate(expectedDate) : null,
        notes: typeof notes === "string" ? notes.slice(0, 1000) : null,
        createdById: session.user.id,
      },
      include: { payments: true },
    })

    logAudit({ action: "create", entityType: "pnl_income", entityId: income.id, entityName: income.title, userId: session.user.id, request, metadata: { projectId, totalAmount } })

    return NextResponse.json(income, { status: 201 })
  } catch (error) {
    console.error("Error creating P&L income:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
