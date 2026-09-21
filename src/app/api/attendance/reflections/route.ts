export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getReflections, isMonthKey, reflectionAccess } from "@/lib/reflection-summaries"

/** A month of someone's daily reflections with GIDEON's day summaries and the month summary, if made. */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const month = request.nextUrl.searchParams.get("month")
    if (!isMonthKey(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 })
    const access = await reflectionAccess(session.user.id, request.nextUrl.searchParams.get("userId"))
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    return NextResponse.json(await getReflections(access.userId, access.workspaceId, month))
  } catch (error) {
    console.error("reflections GET", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
