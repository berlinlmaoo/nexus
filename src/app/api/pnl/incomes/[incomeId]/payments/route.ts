export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlIncomeAccess, parsePnlDate, validAmount } from "@/lib/pnl"

/** Record real money-in against a deal (DP / termin / pelunasan). */
export async function POST(
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
    const date = parsePnlDate(body?.date)
    if (!date) return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 })
    if (!validAmount(body?.amount) || body.amount <= 0) return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })

    const payment = await prisma.pnlIncomePayment.create({
      data: {
        incomeId,
        date,
        amount: body.amount,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
      },
    })

    logAudit({ action: "create", entityType: "pnl_payment", entityId: payment.id, userId: session.user.id, request, metadata: { incomeId, amount: body.amount } })

    return NextResponse.json(payment, { status: 201 })
  } catch (error) {
    console.error("Error creating P&L payment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
