export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { OUTLET_FORM, outletToday } from "@/lib/outlet-sales"
import { deleteOutletEvent, findOutletEvent, outletGate, serializeEvent, updateOutletEvent } from "@/lib/outlet-sales-server"

type Ctx = { params: Promise<{ projectId: string; eventId: string }> }

const notFound = () => NextResponse.json({ error: "Event tidak ditemukan.", code: "EVENT_NOT_FOUND" }, { status: 404 })

/** One event (a shared form link with ?event=, a calendar day of another month), with the form. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId, eventId } = await params
    const gate = await outletGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const row = await findOutletEvent(projectId, eventId)
    if (!row) return notFound()
    return NextResponse.json({ event: serializeEvent(row, outletToday()), form: OUTLET_FORM })
  } catch (error) {
    console.error("Error loading outlet event:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Fill or change the report: only the keys sent change (owner, 10 Oct 2026). Any member. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId, eventId } = await params
    const gate = await outletGate(session.user.id, projectId, "write")
    if (!gate.ok) return gate.response
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const result = await updateOutletEvent(session.user.id, projectId, eventId, body, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json(result.value)
  } catch (error) {
    console.error("Error updating outlet event:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Delete, restorable from Control Room → Audit. Any member, like deleting a task. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId, eventId } = await params
    const gate = await outletGate(session.user.id, projectId, "write")
    if (!gate.ok) return gate.response
    const result = await deleteOutletEvent(session.user.id, gate.project, eventId, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json(result.value)
  } catch (error) {
    console.error("Error deleting outlet event:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
