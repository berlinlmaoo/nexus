export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { putSocialDay, socialGate } from "@/lib/social-media-server"

/**
 * One day of a Social Media Report (owner, 14 Oct 2026). PUT { platforms?: { [platformId]: { views?, likes?,
 * comments?, shares?, posts? } }, worked?, didntWork? }: only the keys sent change; null clears one.
 * Edit access (anyone else 403 NEEDS_EDIT_ACCESS). A date after today (WIB) answers 400 FUTURE_DATE, a
 * platform the project no longer knows 400 CONFIG_CHANGED.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string; date: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId, date } = await params
    const gate = await socialGate(userId, projectId, "record")
    if (!gate.ok) return gate.response
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const result = await putSocialDay(userId, projectId, date, body, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json(result.value)
  } catch (error) {
    console.error("Error saving social media day:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
