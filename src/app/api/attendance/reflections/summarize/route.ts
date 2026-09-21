export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isMonthKey, reflectionAccess, summarizeReflectionMonth } from "@/lib/reflection-summaries"

/** "Summarize what's collected so far": GIDEON reads the month's reflections and writes the month summary. */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => ({}))) as { userId?: string; month?: string; force?: boolean }
    if (!isMonthKey(body.month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 })
    const access = await reflectionAccess(session.user.id, body.userId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    const result = await summarizeReflectionMonth(access.userId, access.workspaceId, body.month, { force: Boolean(body.force) })
    if (!result.monthly) {
      return NextResponse.json(
        { error: result.sourceDays === 0 ? "No reflections in this month yet." : "GIDEON didn't answer. Try again in a minute.", sourceDays: result.sourceDays },
        { status: result.sourceDays === 0 ? 404 : 503 },
      )
    }
    return NextResponse.json({ ...result.monthly, cached: result.cached })
  } catch (error) {
    console.error("reflections summarize", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
