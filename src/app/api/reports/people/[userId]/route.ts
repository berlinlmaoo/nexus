export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { reportableUserIds } from "@/lib/attendance-approvers"
import { buildPeopleReports, publicPeriod, resolveReportWindows } from "@/lib/people-reports"

/**
 * GET /api/reports/people/[userId] — one person's report ("Saya" when userId = "me").
 *
 * Staff only ever get themselves; a manager their direct reports (one level); BoD / OAA / system
 * ADMIN anyone in the workspace. Anything else → 403. Opening somebody else's report is audit-logged.
 * No peer comparison of any kind is in the payload: no rank, no team median, no other person's number.
 *
 * Query: period=YYYY-MM (the 28→27 attendance period ending that month; default: current)
 *        | from=YYYY-MM-DD&to=YYYY-MM-DD.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await auth()
    const viewerId = session?.user?.id
    if (!viewerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { userId: rawUserId } = await params
    const targetId = rawUserId === "me" ? viewerId : rawUserId

    const windows = resolveReportWindows(request.nextUrl.searchParams)
    if ("error" in windows) return NextResponse.json({ error: windows.error }, { status: 400 })

    const scope = await reportableUserIds(viewerId)
    if (!scope.workspaceId) return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    if (!scope.userIds.includes(targetId)) {
      return NextResponse.json({ error: "Forbidden", code: "REPORT_OUT_OF_SCOPE" }, { status: 403 })
    }
    const workspaceId = scope.workspaceId

    const [reports, user, member, teamLinks] = await Promise.all([
      buildPeopleReports({ workspaceId, userIds: [targetId], current: windows.current, previous: windows.previous, detail: true }),
      prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, email: true, avatar: true } }),
      prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: targetId, workspaceId } },
        select: { role: true, approverId: true },
      }),
      prisma.teamMember.findMany({ where: { userId: targetId, team: { workspaceId } }, select: { team: { select: { id: true, name: true } } } }),
    ])
    const report = reports.get(targetId)
    if (!user || !report) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const isSelf = targetId === viewerId
    if (!isSelf) {
      await logAudit({
        action: "view",
        entityType: "person_report",
        entityId: targetId,
        entityName: user.name ?? user.email ?? undefined,
        userId: viewerId,
        metadata: { scope: scope.mode, period: publicPeriod(windows.current) },
        request,
      })
    }

    return NextResponse.json({
      person: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar ?? null,
        role: member?.role ?? null,
        approverId: member?.approverId ?? null,
        teams: teamLinks.map((t) => t.team).sort((a, b) => a.name.localeCompare(b.name)),
        isSelf,
      },
      viewerScope: scope.mode,
      period: publicPeriod(windows.current),
      previousPeriod: publicPeriod(windows.previous),
      headline: report.headline,
      previous: report.previous,
      work: report.work,
      attendance: report.attendance,
      xp: report.xp,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("reports/people/[userId] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
