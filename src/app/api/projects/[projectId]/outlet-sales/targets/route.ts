export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canManageOutletTargets, listOutletTargets, outletGate, putOutletTarget } from "@/lib/outlet-sales-server"

/**
 * Monthly targets of an outlet (owner, 10 Oct 2026). GET: every month that has one, for anyone who can
 * read the project. PUT { month, salesTarget?, paxTarget? }: Full access to the project only (the Project
 * Owner, a member with Full, BoD / One Above All: canManageOutletTargets); anyone else 403 TARGETS_FORBIDDEN.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const gate = await outletGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const [targets, canManageTargets] = await Promise.all([listOutletTargets(projectId), canManageOutletTargets(session.user.id, projectId)])
    return NextResponse.json({ targets, canManageTargets })
  } catch (error) {
    console.error("Error loading outlet targets:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

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
    const result = await putOutletTarget(userId, projectId, body, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json(result.value)
  } catch (error) {
    console.error("Error saving outlet target:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
