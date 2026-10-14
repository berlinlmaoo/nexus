export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isMonth, socialToday } from "@/lib/social-media"
import { loadSocialMonth, socialAbilities, socialGate } from "@/lib/social-media-server"

/**
 * A Social Media Report project's month (owner, 14 Oct 2026): the platforms, every day's figures, notes and
 * targets in force, the monthly and daily targets, and the Overview to date. `?month=YYYY-MM`, default this
 * month (WIB). `canRecord` (Edit access) fills days; `canManage` (Full access) sets targets and platforms.
 * Spec for the apps: apps/android/docs/SOCIAL-MEDIA-REPORT.md.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const gate = await socialGate(session.user.id, projectId, "read")
    if (!gate.ok) return gate.response
    const today = socialToday()
    const raw = request.nextUrl.searchParams.get("month")
    if (raw !== null && raw !== "" && !isMonth(raw)) {
      return NextResponse.json({ field: "month", error: "Bulan harus YYYY-MM.", code: "INVALID_FIELD" }, { status: 400 })
    }
    const month = raw || today.slice(0, 7)
    const [data, abilities] = await Promise.all([loadSocialMonth(projectId, month, today), socialAbilities(session.user.id, projectId)])
    return NextResponse.json({ project: gate.project, ...abilities, ...data })
  } catch (error) {
    console.error("Error loading social media report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
