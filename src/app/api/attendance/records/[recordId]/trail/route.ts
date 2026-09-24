export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reportableUserIds } from "@/lib/attendance-approvers"
import { buildRecordTrail, loadRecordForTrail } from "@/lib/attendance-location"

/**
 * GET /api/attendance/records/[recordId]/trail — the location trail of one check-in, for the map.
 *
 * Who may see it is the one scope rule the Reports use (reportableUserIds in attendance-approvers.ts):
 * BoD / One Above All / system admin — everyone in the workspace; a manager — their direct reports in
 * the Bagan Approval (one level); everyone — themselves. Anything else is 403.
 *
 * (The folder is [recordId], not [id]: Next.js requires one name per dynamic segment and
 * records/[recordId]/route.ts already exists. The URL is the same.)
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { recordId } = await params
    const record = await loadRecordForTrail(recordId)
    if (!record) return NextResponse.json({ error: "Attendance record not found." }, { status: 404 })

    if (record.userId !== session.user.id) {
      const scope = await reportableUserIds(session.user.id)
      if (scope.workspaceId !== record.workspaceId || !scope.userIds.includes(record.userId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    return NextResponse.json(await buildRecordTrail(record), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Error loading location trail:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
