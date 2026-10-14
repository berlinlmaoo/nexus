export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canManageOutletTargets, loadOutletConfig, outletGate, putOutletConfig } from "@/lib/outlet-sales-server"

/**
 * The outlet's report settings (owner, 14 Oct 2026): RSVP items, Hosting items and Communities.
 * GET: { config, usage, canManage } for anyone who can read the project (`usage` = per item id, how many
 * reports hold a figure for it, so a client can ask before it removes one). PUT { config }: the whole list
 * in order; same people as the targets, anyone else 403 SETTINGS_FORBIDDEN. Rules: lib/outlet-sales.ts
 * mergeReportConfig.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const gate = await outletGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const [data, canManage] = await Promise.all([loadOutletConfig(projectId), canManageOutletTargets(session.user.id, projectId)])
    return NextResponse.json({ ...data, canManage })
  } catch (error) {
    console.error("Error loading outlet report settings:", error)
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
        { error: "Pengaturan laporan hanya bisa diubah lead project, Manager, atau BoD.", code: "SETTINGS_FORBIDDEN" },
        { status: 403 },
      )
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const result = await putOutletConfig(userId, projectId, body, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json({ ...result.value, canManage: true })
  } catch (error) {
    console.error("Error saving outlet report settings:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
