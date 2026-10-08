export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { reportableUserIds } from "@/lib/attendance-approvers"
import { buildPeopleReports, publicPeriod, resolveReportWindows, rosterFlags } from "@/lib/people-reports"
import { leftKeyOf } from "@/lib/former-members"

/**
 * GET /api/reports/people — Reports per crew, the roster ("Tim saya").
 *
 * Who is on it is decided HERE from the viewer, never from the client:
 *   BoD / One Above All / system ADMIN → everyone in the workspace (BoD/OAA left out unless
 *                                        includeExempt=1), optionally one team (teamId);
 *   a manager (has direct reports)     → their direct reports, one level; teamId narrows them;
 *   anyone else                        → 403, unless they ask only for themselves (userIds=me).
 * `userIds` (csv, "me" allowed) can only NARROW: one id outside the viewer's scope → 403.
 * People who left (offboarding, 8 Oct 2026) are on it for the periods they were still there for — a
 * last working day on/after the period's first day — with an additive `leftAt` ("YYYY-MM-DD").
 *
 * Query: period=YYYY-MM | from=YYYY-MM-DD&to=YYYY-MM-DD, teamId, userIds, includeExempt=1.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    const viewerId = session?.user?.id
    if (!viewerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const sp = request.nextUrl.searchParams
    const windows = resolveReportWindows(sp)
    if ("error" in windows) return NextResponse.json({ error: windows.error }, { status: 400 })

    const scope = await reportableUserIds(viewerId)
    if (!scope.workspaceId) return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    const workspaceId = scope.workspaceId
    const allowed = new Set(scope.userIds)

    const requested = [...new Set((sp.get("userIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((id) => (id === "me" ? viewerId : id)))]
    let ids: string[]
    if (requested.length > 0) {
      if (requested.some((id) => !allowed.has(id))) {
        return NextResponse.json({ error: "Forbidden", code: "REPORT_OUT_OF_SCOPE" }, { status: 403 })
      }
      ids = requested
    } else if (scope.mode === "SELF") {
      return NextResponse.json({ error: "Forbidden", code: "REPORT_SELF_ONLY" }, { status: 403 })
    } else if (scope.mode === "DIRECT_REPORTS") {
      ids = scope.directReportIds
    } else {
      const includeExempt = sp.get("includeExempt") === "1"
      const exempt = new Set(scope.exemptUserIds)
      ids = scope.userIds.filter((id) => id !== viewerId && (includeExempt || !exempt.has(id)))
    }

    // Someone who left before this period began was not part of it.
    const fromKey = windows.current.from
    ids = ids.filter((id) => {
      const leftKey = leftKeyOf(scope.formerLeftAt.get(id))
      return !leftKey || leftKey >= fromKey
    })

    const teamId = sp.get("teamId")
    let team: { id: string; name: string } | null = null
    if (teamId) {
      team = await prisma.team.findFirst({ where: { id: teamId, workspaceId }, select: { id: true, name: true } })
      if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 })
      const inTeam = new Set((await prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } })).map((m) => m.userId))
      ids = ids.filter((id) => inTeam.has(id))
    }

    const formerIds = ids.filter((id) => scope.formerLeftAt.has(id))
    const [reports, users, members, formers, teamLinks] = await Promise.all([
      buildPeopleReports({ workspaceId, userIds: ids, current: windows.current, previous: windows.previous, detail: false }),
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, avatar: true } }),
      prisma.workspaceMember.findMany({ where: { workspaceId, userId: { in: ids } }, select: { userId: true, role: true, approverId: true } }),
      // What the member row of someone who left said (role, approver).
      formerIds.length
        ? prisma.formerMember.findMany({ where: { workspaceId, userId: { in: formerIds } }, select: { userId: true, role: true, approverId: true } })
        : Promise.resolve([]),
      prisma.teamMember.findMany({
        where: { userId: { in: ids }, team: { workspaceId } },
        select: { userId: true, team: { select: { id: true, name: true } } },
      }),
    ])

    const memberBy = new Map([...formers, ...members].map((m) => [m.userId, m]))
    const teamsBy = new Map<string, { id: string; name: string }[]>()
    for (const t of teamLinks) teamsBy.set(t.userId, [...(teamsBy.get(t.userId) ?? []), t.team])

    const rows = users
      .map((u) => {
        const r = reports.get(u.id)
        if (!r) return null
        const flags = rosterFlags(r.headline)
        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          avatar: u.avatar ?? null,
          role: memberBy.get(u.id)?.role ?? null,
          approverId: memberBy.get(u.id)?.approverId ?? null,
          teams: (teamsBy.get(u.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
          headline: r.headline,
          previous: r.previous,
          flags: { overdue3: flags.overdue3, late3: flags.late3, lowReflections: flags.lowReflections },
          flagCount: flags.count,
          ...(scope.formerLeftAt.has(u.id) ? { leftAt: leftKeyOf(scope.formerLeftAt.get(u.id)) } : {}),
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.flagCount - a.flagCount || (a.name ?? "").localeCompare(b.name ?? ""))

    if (ids.some((id) => id !== viewerId)) {
      await logAudit({
        action: "view",
        entityType: "person_report_roster",
        entityId: team?.id ?? workspaceId,
        entityName: team?.name ?? undefined,
        userId: viewerId,
        metadata: { scope: scope.mode, period: publicPeriod(windows.current), count: rows.length, teamId: team?.id ?? null },
        request,
      })
    }

    return NextResponse.json({
      scope: scope.mode,
      period: publicPeriod(windows.current),
      previousPeriod: publicPeriod(windows.previous),
      team,
      rows,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("reports/people roster error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
