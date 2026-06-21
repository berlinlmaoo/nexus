export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess, parsePnlDate, validAmount } from "@/lib/pnl"

async function gatePayment(userId: string, paymentId: string) {
  const payment = await prisma.pnlIncomePayment.findUnique({
    where: { id: paymentId },
    select: { id: true, income: { select: { projectId: true } } },
  })
  if (!payment) return { ok: false as const, status: 404 as const, error: "Payment not found" }
  const gate = await checkPnlAccess(userId, payment.income.projectId)
  if (!gate.allowed) return { ok: false as const, status: gate.status, error: gate.error }
  return { ok: true as const, status: 200 as const, error: null }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { paymentId } = await params
    const gate = await gatePayment(session.user.id, paymentId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json()
    const data: { date?: Date; amount?: number; note?: string | null } = {}
    if (body.date !== undefined) {
      const parsed = parsePnlDate(body.date)
      if (!parsed) return NextResponse.json({ error: "Invalid date (YYYY-MM-DD)" }, { status: 400 })
      data.date = parsed
    }
    if (body.amount !== undefined) {
      if (!validAmount(body.amount) || body.amount <= 0) return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
      data.amount = body.amount
    }
    if (body.note !== undefined) {
      data.note = typeof body.note === "string" ? body.note.slice(0, 500) : null
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 })

    const payment = await prisma.pnlIncomePayment.update({ where: { id: paymentId }, data })

    logAudit({ action: "update", entityType: "pnl_payment", entityId: paymentId, userId: session.user.id, request })

    return NextResponse.json(payment)
  } catch (error) {
    console.error("Error updating P&L payment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { paymentId } = await params
    const gate = await gatePayment(session.user.id, paymentId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    await prisma.pnlIncomePayment.delete({ where: { id: paymentId } })

    logAudit({ action: "delete", entityType: "pnl_payment", entityId: paymentId, userId: session.user.id, request })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting P&L payment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
