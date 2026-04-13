import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTeamAvailability, normalizeMasterCalendarRange } from "@/lib/master-calendar"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const teamId = searchParams.get("teamId")
    const date = searchParams.get("date")
    const startTime = searchParams.get("startTime")
    const endTime = searchParams.get("endTime")
    const isAllDay = searchParams.get("isAllDay") === "true"
    const excludeEventId = searchParams.get("excludeEventId") ?? undefined

    if (!teamId || !date) {
      return NextResponse.json({ error: "teamId and date are required" }, { status: 400 })
    }

    const { startsAt, endsAt } = normalizeMasterCalendarRange({
      date,
      isAllDay,
      startTime,
      endTime,
    })

    const result = await getTeamAvailability({
      actorId: session.user.id,
      teamId,
      startsAt,
      endsAt,
      isAllDay,
      excludeEventId,
    })

    if (result.error === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json({ attendees: result.attendees })
  } catch (error) {
    console.error("Master calendar availability error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}
