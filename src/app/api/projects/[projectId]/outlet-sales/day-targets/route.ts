export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canManageOutletTargets, outletGate, putOutletDayTarget } from "@/lib/outlet-sales-server"

/**
 * A date's own target (owner, 14 Oct 2026, after a meeting with Ryan). PUT { date, salesTarget?,
 * paxTarget? }: sales only, pax only or both; null clears a part, which then falls back to the month's
 * target split over its days. The month's answer (GET …/outlet-sales) carries every day's target in force
 * (`days`). Same people as the monthly target (canManageOutletTargets); anyone else 403 TARGETS_FORBIDDEN.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId } = await params
    const gate = await outletGate(userId, projectId, "read")
    if (!gate.ok) return gate.response
    if (!(await canManageOutletTargets(userId, projectId))) {
      return NextResponse.json(
        { error: "Target hanya bisa diatur oleh yang punya akses Full di project ini.", code: "TARGETS_FORBIDDEN" },
        { status: 403 },
      )
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const result = await putOutletDayTarget(userId, projectId, body, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json(result.value)
  } catch (error) {
    console.error("Error saving outlet day target:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
