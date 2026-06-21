export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess, pnlRecurringCursorForNow, validAmount } from "@/lib/pnl"

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { projectId, description, amount, categoryId, dayOfMonth } = body ?? {}
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const gate = await checkPnlAccess(session.user.id, projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    if (typeof description !== "string" || !description.trim()) return NextResponse.json({ error: "description is required" }, { status: 400 })
    if (!validAmount(amount) || amount <= 0) return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
    const day = Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31 ? dayOfMonth : 1

    if (categoryId) {
      const cat = await prisma.pnlCategory.findFirst({ where: { id: categoryId, projectId }, select: { id: true } })
      if (!cat) return NextResponse.json({ error: "Category not found in this project" }, { status: 400 })
    }

    // Start posting from "now": current month is marked handled once its posting day passed
    // (so creating "gaji tanggal 1" on the 15th doesn't instantly backfill a month the user may
    // have already logged manually); otherwise the cursor sits at last month so THIS month posts
    // when its day arrives — never anything earlier.
    const lastPostedKey = pnlRecurringCursorForNow(day)

    const recurring = await prisma.pnlRecurringExpense.create({
      data: {
        projectId,
        description: description.trim().slice(0, 200),
        amount,
        categoryId: categoryId || null,
        dayOfMonth: day,
        lastPostedKey,
      },
    })

    logAudit({ action: "create", entityType: "pnl_recurring", entityId: recurring.id, entityName: recurring.description, userId: session.user.id, request, metadata: { projectId, amount } })

    return NextResponse.json(recurring, { status: 201 })
  } catch (error) {
    console.error("Error creating P&L recurring expense:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
