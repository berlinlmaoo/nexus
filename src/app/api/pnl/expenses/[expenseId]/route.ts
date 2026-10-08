export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlExpenseAccess, parsePnlDate, validAmount } from "@/lib/pnl"
import { restorableDelete } from "@/lib/deletion-snapshot"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { expenseId } = await params
    const gate = await checkPnlExpenseAccess(session.user.id, expenseId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json()
    const data: { date?: Date; amount?: number; description?: string | null; categoryId?: string | null } = {}

    if (body.date !== undefined) {
      const parsed = parsePnlDate(body.date)
      if (!parsed) return NextResponse.json({ error: "Invalid date (YYYY-MM-DD)" }, { status: 400 })
      data.date = parsed
    }
    if (body.amount !== undefined) {
      if (!validAmount(body.amount) || body.amount <= 0) return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
      data.amount = body.amount
    }
    if (body.description !== undefined) {
      data.description = typeof body.description === "string" ? body.description.slice(0, 1000) : null
    }
    if (body.categoryId !== undefined) {
      if (body.categoryId) {
        const cat = await prisma.pnlCategory.findFirst({ where: { id: body.categoryId, projectId: gate.expense.projectId }, select: { id: true } })
        if (!cat) return NextResponse.json({ error: "Category not found in this project" }, { status: 400 })
        data.categoryId = body.categoryId
      } else {
        data.categoryId = null
      }
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 })

    const expense = await prisma.pnlExpense.update({ where: { id: expenseId }, data, include: { attachments: true } })

    logAudit({ action: "update", entityType: "pnl_expense", entityId: expenseId, entityName: expense.description ?? `Rp ${expense.amount}`, userId: session.user.id, request, metadata: { projectId: gate.expense.projectId } })

    return NextResponse.json(expense)
  } catch (error) {
    console.error("Error updating P&L expense:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { expenseId } = await params
    const gate = await checkPnlExpenseAccess(session.user.id, expenseId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    // Kept with its receipts first (their files stay on disk), so Control Room → Audit can restore it.
    // The 90-day purge of copies removes the files once nothing points at them.
    const expense = await prisma.pnlExpense.findUniqueOrThrow({
      where: { id: expenseId },
      select: { description: true, amount: true, project: { select: { workspaceId: true } } },
    })
    const projectId = gate.expense.projectId
    await restorableDelete({
      entityType: "pnl_expense", entityId: expenseId, entityName: expense.description ?? `Rp ${expense.amount}`,
      workspaceId: expense.project.workspaceId, userId: session.user.id, request,
      metadata: { projectId, amount: expense.amount },
      meta: { open: { type: "pnl", id: projectId, projectId: projectId }, projectId: projectId },
      remove: (tx) => tx.pnlExpense.delete({ where: { id: expenseId } }),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting P&L expense:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
