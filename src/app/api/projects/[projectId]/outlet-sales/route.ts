export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isMonth, outletToday } from "@/lib/outlet-sales"
import { canManageOutletTargets, loadOutletMonth, outletGate } from "@/lib/outlet-sales-server"

/**
 * An Outlet Sales Dashboard project's month (owner, 10 Oct 2026, for Ryan): the month's target and
 * summary (sales / pax vs target), its events with their reports, older nights still waiting for a
 * report, and the default form. `?month=YYYY-MM`, default this month (WIB). Spec:
 * ~/handoff/chat/OUTLET-SALES.md.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const gate = await outletGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const today = outletToday()
    const raw = request.nextUrl.searchParams.get("month")
    if (raw !== null && raw !== "" && !isMonth(raw)) {
      return NextResponse.json({ field: "month", error: "Bulan harus YYYY-MM.", code: "INVALID_FIELD" }, { status: 400 })
    }
    const month = raw || today.slice(0, 7)
    const [data, canManageTargets] = await Promise.all([
      loadOutletMonth(projectId, month, today),
      canManageOutletTargets(session.user.id, projectId),
    ])
    return NextResponse.json({ project: gate.project, canManageTargets, ...data })
  } catch (error) {
    console.error("Error loading outlet sales:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
