export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess, validAmount } from "@/lib/pnl"

/** Upsert one month's expense-budget target. amount 0 clears the target (row removed). */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { projectId, year, month, amount } = body ?? {}
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const gate = await checkPnlAccess(session.user.id, projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Invalid year" }, { status: 400 })
    if (!Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "Invalid month (1-12)" }, { status: 400 })
    if (!validAmount(amount)) return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 })

    if (amount === 0) {
      await prisma.pnlBudget.deleteMany({ where: { projectId, year, month } })
      logAudit({ action: "delete", entityType: "pnl_budget", entityId: `${projectId}:${year}-${month}`, userId: session.user.id, request })
      return NextResponse.json({ success: true, cleared: true })
    }

    const budget = await prisma.pnlBudget.upsert({
      where: { projectId_year_month: { projectId, year, month } },
      create: { projectId, year, month, amount },
      update: { amount },
    })

    logAudit({ action: "update", entityType: "pnl_budget", entityId: budget.id, userId: session.user.id, request, metadata: { projectId, year, month, amount } })

    return NextResponse.json(budget)
  } catch (error) {
    console.error("Error upserting P&L budget:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
