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
    const { projectId, date, amount, description, categoryId } = body ?? {}
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const gate = await checkPnlAccess(session.user.id, projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const parsedDate = parsePnlDate(date)
    if (!parsedDate) return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 })
    if (!validAmount(amount) || amount <= 0) return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })

    if (categoryId) {
      const cat = await prisma.pnlCategory.findFirst({ where: { id: categoryId, projectId }, select: { id: true } })
      if (!cat) return NextResponse.json({ error: "Category not found in this project" }, { status: 400 })
    }

    const expense = await prisma.pnlExpense.create({
      data: {
        projectId,
        date: parsedDate,
        amount,
        description: typeof description === "string" ? description.slice(0, 1000) : null,
        categoryId: categoryId || null,
        createdById: session.user.id,
      },
      include: { attachments: true },
    })

    logAudit({ action: "create", entityType: "pnl_expense", entityId: expense.id, entityName: expense.description ?? `Rp ${amount}`, userId: session.user.id, request, metadata: { projectId, amount } })

    return NextResponse.json(expense, { status: 201 })
  } catch (error) {
    console.error("Error creating P&L expense:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
