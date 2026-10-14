export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { hasProjectLevel } from "@/lib/rbac"
import { loadSocialSettings, putSocialConfig, socialGate } from "@/lib/social-media-server"

/**
 * The platforms a Social Media Report tracks (owner, 14 Oct 2026). GET: { config, usage, canManage } for
 * anyone who can read the project (`usage` = per platform id, how many days and targets hold something, so a
 * client can ask before it archives one). PUT { config: { platforms: [{ id?, name, archived? }] } }: the
 * whole list in order; Full access, anyone else 403 SETTINGS_FORBIDDEN. Rules: lib/social-media.ts
 * mergeSocialConfig.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const gate = await socialGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const [data, canManage] = await Promise.all([loadSocialSettings(projectId), hasProjectLevel(session.user.id, projectId, "FULL")])
    return NextResponse.json({ ...data, canManage })
  } catch (error) {
    console.error("Error loading social media platforms:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

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
    const result = await putSocialConfig(userId, projectId, body, request)
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json({ ...result.value, canManage: true })
  } catch (error) {
    console.error("Error saving social media platforms:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
