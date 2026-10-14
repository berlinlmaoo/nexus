export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { putSocialDayTargets, socialGate } from "@/lib/social-media-server"

/**
 * A date's own targets per platform (owner, 14 Oct 2026). PUT { date, platforms: { [platformId]: {
 * engagementTarget?, postsTarget? } } }: null clears a part, which then falls back to the month's target split
 * over its days. Full access (the Project
 * Owner, BoD / One Above All, a system admin); anyone else 403 SETTINGS_FORBIDDEN.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { projectId } = await params
    const gate = await socialGate(userId, projectId, "manage")
    if (!gate.ok) return gate.response
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const result = await putSocialDayTargets(userId, projectId, body, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json(result.value)
  } catch (error) {
    console.error("Error saving social media targets:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
