export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createOutletEvent, outletGate } from "@/lib/outlet-sales-server"

/** A new event of the outlet, with as much of its report as is known (owner, 10 Oct 2026). Any member. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const gate = await outletGate(session.user.id, projectId, "write")
    if (!gate.ok) return gate.response
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const result = await createOutletEvent(session.user.id, projectId, body, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    // A repeat of the same press (race audit M9): the night already stored, 200 instead of 201.
    return NextResponse.json(result.value, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    console.error("Error creating outlet event:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
