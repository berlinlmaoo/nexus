export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkPnlAccess, ensurePnlDefaults, postDueRecurringPnlExpenses } from "@/lib/pnl"

/**
 * The whole P&L view in one read: monthly income/expense/budget arrays for a year, expense
 * breakdown by category, the income pipeline (all-time state) with per-deal paid/outstanding,
 * recurring templates, and — when ?month=1..12 is passed — that month's daily breakdown +
 * transaction lists for the drill-down.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const projectId = request.nextUrl.searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const gate = await checkPnlAccess(session.user.id, projectId)
    if (!gate.allowed) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const nowYear = new Date().getUTCFullYear()
    const yearRaw = Number(request.nextUrl.searchParams.get("year"))
    const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : nowYear
    const monthRaw = Number(request.nextUrl.searchParams.get("month"))
    const month = Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null

    // Lazy work on load: seed first-open defaults + materialize due recurring expenses.
    await ensurePnlDefaults(projectId)
    await postDueRecurringPnlExpenses(projectId)

    const yearStart = new Date(Date.UTC(year, 0, 1))
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1))

    const [expenses, categories, stages, incomes, budgets, recurring] = await Promise.all([
      prisma.pnlExpense.findMany({
        where: { projectId, date: { gte: yearStart, lt: yearEnd } },
        select: { id: true, date: true, amount: true, categoryId: true },
      }),
      prisma.pnlCategory.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
      prisma.pnlIncomeStage.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
      prisma.pnlIncome.findMany({
        where: { projectId },
        include: { payments: { orderBy: { date: "asc" } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.pnlBudget.findMany({ where: { projectId, year } }),
      prisma.pnlRecurringExpense.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    ])

    const zero12 = () => Array.from({ length: 12 }, () => 0)
    const expenseByMonth = zero12()
    const catAgg = new Map<string | null, { total: number; byMonth: number[] }>()
    for (const e of expenses) {
      const m = e.date.getUTCMonth()
      expenseByMonth[m] += e.amount
      const key = e.categoryId ?? null
      const agg = catAgg.get(key) ?? { total: 0, byMonth: zero12() }
      agg.total += e.amount
      agg.byMonth[m] += e.amount
      catAgg.set(key, agg)
    }

    const incomeByMonth = zero12()
    let paidAllTime = 0
    const incomesOut = incomes.map((inc) => {
      let paid = 0
      for (const p of inc.payments) {
        paid += p.amount
        paidAllTime += p.amount
        if (p.date >= yearStart && p.date < yearEnd) incomeByMonth[p.date.getUTCMonth()] += p.amount
      }
      return {
        id: inc.id,
        title: inc.title,
        totalAmount: inc.totalAmount,
        stageId: inc.stageId,
        expectedDate: inc.expectedDate,
        notes: inc.notes,
        createdAt: inc.createdAt,
        paid,
        outstanding: Math.max(0, inc.totalAmount - paid),
        payments: inc.payments.map((p) => ({ id: p.id, date: p.date, amount: p.amount, note: p.note })),
      }
    })

    const budgetByMonth: (number | null)[] = Array.from({ length: 12 }, () => null)
    for (const b of budgets) budgetByMonth[b.month - 1] = b.amount

    const categoriesOut = categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      order: c.order,
      total: catAgg.get(c.id)?.total ?? 0,
      byMonth: catAgg.get(c.id)?.byMonth ?? zero12(),
    }))
    const uncat = catAgg.get(null)
    if (uncat && uncat.total > 0) {
      categoriesOut.push({ id: "", name: "Tanpa kategori", color: "#cbd5e1", order: 9999, total: uncat.total, byMonth: uncat.byMonth })
    }

    const stagesOut = stages.map((s) => {
      const list = incomesOut.filter((i) => i.stageId === s.id)
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        order: s.order,
        count: list.length,
        outstanding: list.reduce((sum, i) => sum + i.outstanding, 0),
      }
    })

    const incomeTotal = incomeByMonth.reduce((a, b) => a + b, 0)
    const expenseTotal = expenseByMonth.reduce((a, b) => a + b, 0)

    // Month drill-down: daily sums + full transaction lists with attachments.
    let monthDetail = null
    if (month) {
      const mStart = new Date(Date.UTC(year, month - 1, 1))
      const mEnd = new Date(Date.UTC(year, month, 1))
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
      const [mExpenses, mPayments] = await Promise.all([
        prisma.pnlExpense.findMany({
          where: { projectId, date: { gte: mStart, lt: mEnd } },
          include: { attachments: { select: { id: true, filename: true, url: true, mimeType: true, size: true } } },
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        }),
        prisma.pnlIncomePayment.findMany({
          where: { income: { projectId }, date: { gte: mStart, lt: mEnd } },
          include: { income: { select: { id: true, title: true } } },
          orderBy: { date: "asc" },
        }),
      ])
      const days = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, income: 0, expense: 0 }))
      for (const e of mExpenses) days[e.date.getUTCDate() - 1].expense += e.amount
      for (const p of mPayments) days[p.date.getUTCDate() - 1].income += p.amount
      monthDetail = {
        month,
        days,
        expenses: mExpenses.map((e) => ({
          id: e.id,
          date: e.date,
          amount: e.amount,
          description: e.description,
          categoryId: e.categoryId,
          recurringId: e.recurringId,
          attachments: e.attachments,
        })),
        payments: mPayments.map((p) => ({ id: p.id, date: p.date, amount: p.amount, note: p.note, incomeId: p.income.id, incomeTitle: p.income.title })),
      }
    }

    return NextResponse.json({
      year,
      months: { income: incomeByMonth, expense: expenseByMonth, budget: budgetByMonth },
      totals: {
        income: incomeTotal,
        expense: expenseTotal,
        profit: incomeTotal - expenseTotal,
        pipelineTotal: incomesOut.reduce((s, i) => s + i.totalAmount, 0),
        pipelineOutstanding: incomesOut.reduce((s, i) => s + i.outstanding, 0),
        paidAllTime,
      },
      categories: categoriesOut,
      stages: stagesOut,
      incomes: incomesOut,
      recurring: recurring.map((r) => ({
        id: r.id,
        description: r.description,
        amount: r.amount,
        categoryId: r.categoryId,
        dayOfMonth: r.dayOfMonth,
        active: r.active,
      })),
      monthDetail,
    })
  } catch (error) {
    console.error("Error building P&L dashboard:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
