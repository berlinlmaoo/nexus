export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess, pnlRecurringCursorForNow, validAmount } from "@/lib/pnl"

async function gateRecurring(userId: string, recurringId: string) {
  const recurring = await prisma.pnlRecurringExpense.findUnique({ where: { id: recurringId }, select: { id: true, projectId: true, active: true, dayOfMonth: true } })
  if (!recurring) return { ok: false as const, status: 404 as const, error: "Recurring expense not found", recurring: null }
  const gate = await checkPnlAccess(userId, recurring.projectId)
  if (!gate.allowed) return { ok: false as const, status: gate.status, error: gate.error, recurring: null }
  return { ok: true as const, status: 200 as const, error: null, recurring }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recurringId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { recurringId } = await params
    const gate = await gateRecurring(session.user.id, recurringId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json()
    const data: { description?: string; amount?: number; categoryId?: string | null; dayOfMonth?: number; active?: boolean; lastPostedKey?: string } = {}
    if (body.description !== undefined) {
      if (typeof body.description !== "string" || !body.description.trim()) return NextResponse.json({ error: "description cannot be empty" }, { status: 400 })
      data.description = body.description.trim().slice(0, 200)
    }
    if (body.amount !== undefined) {
      if (!validAmount(body.amount) || body.amount <= 0) return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
      data.amount = body.amount
    }
    if (body.categoryId !== undefined) {
      if (body.categoryId) {
        const cat = await prisma.pnlCategory.findFirst({ where: { id: body.categoryId, projectId: gate.recurring.projectId }, select: { id: true } })
        if (!cat) return NextResponse.json({ error: "Category not found in this project" }, { status: 400 })
        data.categoryId = body.categoryId
      } else {
        data.categoryId = null
      }
    }
    if (body.dayOfMonth !== undefined) {
      if (!Number.isInteger(body.dayOfMonth) || body.dayOfMonth < 1 || body.dayOfMonth > 31) return NextResponse.json({ error: "dayOfMonth must be 1-31" }, { status: 400 })
      data.dayOfMonth = body.dayOfMonth
    }
    if (body.active !== undefined) {
      data.active = !!body.active
      // Pause → resume must NOT retro-bill the paused months: while paused the materializer
      // skips the template so its cursor freezes; advancing it to "now" on reactivation makes
      // posting resume from the current month instead of backfilling every paused month.
      if (data.active && !gate.recurring.active) {
        data.lastPostedKey = pnlRecurringCursorForNow(data.dayOfMonth ?? gate.recurring.dayOfMonth)
      }
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 })

    const recurring = await prisma.pnlRecurringExpense.update({ where: { id: recurringId }, data })

    logAudit({ action: "update", entityType: "pnl_recurring", entityId: recurringId, entityName: recurring.description, userId: session.user.id, request })

    return NextResponse.json(recurring)
  } catch (error) {
    console.error("Error updating P&L recurring expense:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ recurringId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { recurringId } = await params
    const gate = await gateRecurring(session.user.id, recurringId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    // Template removal keeps already-posted expense entries (their recurringId goes SetNull).
    await prisma.pnlRecurringExpense.delete({ where: { id: recurringId } })

    logAudit({ action: "delete", entityType: "pnl_recurring", entityId: recurringId, userId: session.user.id, request })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting P&L recurring expense:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
