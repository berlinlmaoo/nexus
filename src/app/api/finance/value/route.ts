export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"

// Upsert one monthly finance cell (project + line item + year + month -> amount).
// Gated to project members (Gerald / finance staff / BoD).
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => null) as
      | { projectId?: string; lineItemId?: string; year?: number; month?: number; amount?: number }
      | null
    const projectId = body?.projectId
    const lineItemId = body?.lineItemId
    const year = Number(body?.year)
    const month = Number(body?.month)
    const amount = Number(body?.amount)

    if (!projectId || !lineItemId || !Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "projectId, lineItemId, year, month(1-12), amount required" }, { status: 400 })
    }

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Make sure the line item exists (avoid orphan rows).
    const li = await prisma.financeLineItem.findUnique({ where: { id: lineItemId }, select: { id: true } })
    if (!li) return NextResponse.json({ error: "Line item not found" }, { status: 404 })

    const value = await prisma.financeValue.upsert({
      where: { projectId_lineItemId_year_month: { projectId, lineItemId, year, month } },
      create: { projectId, lineItemId, year, month, amount, updatedById: session.user.id },
      update: { amount, updatedById: session.user.id },
      select: { id: true, amount: true, month: true, year: true, lineItemId: true },
    })

    return NextResponse.json({ value })
  } catch (error) {
    console.error("finance value upsert error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
