export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"

// Finance dashboard for one project + year: the shared OPEX/REVENUE structure with this
// project's monthly amounts filled in, plus computed totals & profit. Gated to project members.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const projectId = req.nextUrl.searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 })
    const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear()

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const [categories, values] = await Promise.all([
      prisma.financeCategory.findMany({
        orderBy: { order: "asc" },
        include: { lineItems: { orderBy: { order: "asc" } } },
      }),
      prisma.financeValue.findMany({ where: { projectId, year }, select: { lineItemId: true, month: true, amount: true } }),
    ])

    // lineItemId -> [12 months]
    const byItem = new Map<string, number[]>()
    for (const v of values) {
      if (!byItem.has(v.lineItemId)) byItem.set(v.lineItemId, Array(12).fill(0))
      if (v.month >= 1 && v.month <= 12) byItem.get(v.lineItemId)![v.month - 1] = v.amount
    }

    const opexByMonth = Array(12).fill(0)
    const revenueByMonth = Array(12).fill(0)

    const cats = categories.map((c) => {
      const items = c.lineItems.map((li) => {
        const monthly = byItem.get(li.id) ?? Array(12).fill(0)
        const total = monthly.reduce((a, b) => a + b, 0)
        for (let m = 0; m < 12; m++) {
          if (c.kind === "REVENUE") revenueByMonth[m] += monthly[m]
          else opexByMonth[m] += monthly[m]
        }
        return { id: li.id, name: li.name, order: li.order, monthly, total }
      })
      const subtotalByMonth = Array(12).fill(0)
      for (const it of items) for (let m = 0; m < 12; m++) subtotalByMonth[m] += it.monthly[m]
      const subtotal = subtotalByMonth.reduce((a, b) => a + b, 0)
      return { id: c.id, kind: c.kind, name: c.name, order: c.order, lineItems: items, subtotalByMonth, subtotal }
    })

    const opexTotal = opexByMonth.reduce((a, b) => a + b, 0)
    const revenueTotal = revenueByMonth.reduce((a, b) => a + b, 0)
    const profitByMonth = revenueByMonth.map((r, m) => r - opexByMonth[m])
    const profitTotal = revenueTotal - opexTotal

    return NextResponse.json({
      year,
      categories: cats,
      totals: { opexByMonth, revenueByMonth, profitByMonth, opexTotal, revenueTotal, profitTotal },
    })
  } catch (error) {
    console.error("finance dashboard error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
