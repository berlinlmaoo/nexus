export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit, logViewOncePerDay } from "@/lib/audit"
import { reportableUserIds } from "@/lib/attendance-approvers"
import { hasProjectWideAccess } from "@/lib/rbac"
import { buildPeopleReports, publicPeriod, resolveReportWindows } from "@/lib/people-reports"
import { leftKeyOf } from "@/lib/former-members"

/**
 * GET /api/reports/people/[userId] — one person's report ("Saya" when userId = "me").
 *
 * Staff only ever get themselves; a manager their direct reports (one level); BoD / OAA / system
 * ADMIN anyone in the workspace. Anything else → 403. Opening somebody else's report is audit-logged.
 * Someone who left (offboarding, 8 Oct 2026) can still be opened by the same people, for any period;
 * `person.leftAt` ("YYYY-MM-DD", additive) is their last working day.
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

    const leftAt = scope.formerLeftAt.get(targetId) ?? null
    const [reports, user, currentMember, teamLinks] = await Promise.all([
      buildPeopleReports({ workspaceId, userIds: [targetId], current: windows.current, previous: windows.previous, detail: true }),
      prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, email: true, avatar: true } }),
      prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: targetId, workspaceId } },
        select: { role: true, approverId: true },
      }),
      prisma.teamMember.findMany({ where: { userId: targetId, team: { workspaceId } }, select: { team: { select: { id: true, name: true } } } }),
    ])
    // Someone who left: what their member row said.
    const member = currentMember ?? (leftAt
      ? await prisma.formerMember.findUnique({ where: { userId_workspaceId: { userId: targetId, workspaceId } }, select: { role: true, approverId: true } })
      : null)
    const report = reports.get(targetId)
    if (!user || !report) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const isSelf = targetId === viewerId
    // Project names follow project access (owner 13 Oct 2026): a manager reading a report sees the projects
    // they can open; the rest are counted together as "Other projects", their overdue tasks without title.
    let work = report.work
    if (!isSelf) {
      const [viewerUser, viewerMember] = await Promise.all([
        prisma.user.findUnique({ where: { id: viewerId }, select: { role: true } }),
        prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: viewerId, workspaceId } }, select: { role: true } }),
      ])
      if (viewerUser?.role !== "ADMIN" && !hasProjectWideAccess(viewerMember?.role)) {
        const ids = [...new Set([...work.perProject.map((p) => p.projectId), ...work.overdueList.map((o) => o.projectId)])]
        const mine = new Set((await prisma.projectMember.findMany({ where: { userId: viewerId, projectId: { in: ids } }, select: { projectId: true } })).map((m) => m.projectId))
        const shown = work.perProject.filter((p) => mine.has(p.projectId))
        const hidden = work.perProject.filter((p) => !mine.has(p.projectId))
        const r1 = (n: number) => Math.round(n * 10) / 10
        const other = hidden.length
          ? [{ projectId: "other", projectName: "Other projects", completed: r1(hidden.reduce((n, p) => n + p.completed, 0)), open: r1(hidden.reduce((n, p) => n + p.open, 0)), overdue: r1(hidden.reduce((n, p) => n + p.overdue, 0)), hiddenProjects: hidden.length }]
          : []
        work = {
          ...work,
          perProject: [...shown, ...other],
          overdueList: work.overdueList.map((o) => (mine.has(o.projectId) ? o : { ...o, id: "", title: "Task in a project you're not in", projectId: "other", projectName: "Other projects" })),
        }
      }
    }
    if (!isSelf) {
      await logViewOncePerDay({
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
        ...(leftAt && !currentMember ? { leftAt: leftKeyOf(leftAt) } : {}),
      },
      viewerScope: scope.mode,
      period: publicPeriod(windows.current),
      previousPeriod: publicPeriod(windows.previous),
      headline: report.headline,
      previous: report.previous,
      work,
      attendance: report.attendance,
      xp: report.xp,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("reports/people/[userId] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
