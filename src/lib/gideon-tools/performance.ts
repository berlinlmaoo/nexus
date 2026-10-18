import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { reportableUserIds } from "@/lib/attendance-approvers"
import { buildPeopleReports, resolveReportWindows, type HeadlineFigures, type PersonReportData, type Ratio } from "@/lib/people-reports"
import { getLeaderboardPeriodStart, levelForXp, PERIOD_BASELINE_XP } from "@/lib/gamification"
import { findPerson, str, PUBLIC_BASE } from "./util"
import type { ExtraTool, Input } from "./types"

/**
 * Performance through GIDEON (owner, 18 Oct 2026): Reports per crew (lib/people-reports.ts buildPeopleReports, the
 * same builder as /api/reports/people) with the same scope rule, reportableUserIds (memory nexus-reports-per-crew):
 * Staff = themselves only (no peers, no team median), a Manager = their direct reports (one level), BoD / One Above
 * All = everyone. Period = the attendance period 28th → 27th (period=YYYY-MM picks another). Task counts with
 * several assignees are split 1/n, as on the page. XP / level / rank = the Leaderboard page's numbers (this
 * period's score from PERIOD_BASELINE_XP; BoD and One Above All are not ranked).
 */

const pct = (r: Ratio) => (r.den > 0 ? `${Math.round((r.num / r.den) * 100)}% (${r.num}/${r.den})` : "—")

function headline(h: HeadlineFigures) {
  return {
    tasksAssigned: h.assigned,
    tasksCompleted: h.completed,
    onTime: pct(h.onTime),
    overdueNow: h.overdue,
    ...(h.medianCycleDays !== null ? { medianDaysToFinish: h.medianCycleDays } : {}),
    present: h.present,
    late: h.late,
    ...(h.lateMinutes ? { lateMinutes: h.lateMinutes } : {}),
    absent: h.absent,
    leave: h.leave,
    sick: h.sick,
    permit: h.permit,
    dayOff: h.dayOff,
    attendanceRate: pct(h.attendanceRate),
    xpScore: h.xpScore,
    ...(h.xpPenalty ? { xpPenalty: h.xpPenalty } : {}),
  }
}

function personDetail(d: PersonReportData) {
  return {
    ...headline(d.headline),
    previousPeriod: { tasksCompleted: d.previous.completed, onTime: pct(d.previous.onTime), late: d.previous.late, xpScore: d.previous.xpScore },
    openTasks: d.work.openTotal,
    dueNext7Days: d.work.dueNext7,
    overdue: d.work.overdueList.slice(0, 8).map((t) => ({ title: t.title, project: t.projectName, due: t.dueKey, daysOverdue: t.daysOverdue })),
    perProject: d.work.perProject.slice(0, 8).map((p) => ({ project: p.projectName, completed: p.completed, open: p.open, overdue: p.overdue })),
    level: `${d.xp.level.level} · ${d.xp.level.name}${d.xp.level.isMax ? "" : ` (${d.xp.level.pct}% to the next)`}`,
    streak: d.xp.streak,
    ...(d.xp.penalties.length ? { penalties: d.xp.penalties.map((p) => ({ kind: p.kind, times: p.count, xp: p.xp })) } : {}),
  }
}

/** The Leaderboard page's ranking (GET /api/gamification/leaderboard): this period's score, BoD/OAA left out. */
async function leaderboard(viewerId: string) {
  const ws = (await prisma.workspaceMember.findMany({ where: { userId: viewerId }, select: { workspaceId: true } })).map((m) => m.workspaceId)
  if (!ws.length) return null
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId: { in: ws } }, select: { userId: true, role: true } })
  const excluded = new Set(members.filter((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL").map((m) => m.userId))
  const ids = [...new Set(members.map((m) => m.userId))]
  const [txns, users] = await Promise.all([
    prisma.xpTransaction.groupBy({ by: ["userId"], where: { userId: { in: ids }, createdAt: { gte: getLeaderboardPeriodStart() } }, _sum: { amount: true } }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ])
  const delta = new Map(txns.map((t) => [t.userId, t._sum.amount ?? 0]))
  const rows = users.filter((u) => !excluded.has(u.id)).map((u) => ({ id: u.id, name: u.name ?? "?", score: PERIOD_BASELINE_XP + (delta.get(u.id) ?? 0) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const me = rows.findIndex((r) => r.id === viewerId)
  return {
    ranked: me >= 0,
    ...(me >= 0 ? { rank: me + 1, of: rows.length, score: rows[me].score, level: levelForXp(rows[me].score).name } : { note: "BoD / One Above All are not ranked on the leaderboard." }),
    top5: rows.slice(0, 5).map((r, i) => ({ rank: i + 1, name: r.name, score: r.score })),
  }
}

async function getPerformance(actor: User, input: Input) {
  const sp = new URLSearchParams()
  const period = str(input.period)
  if (period) sp.set("period", period)
  const windows = resolveReportWindows(sp)
  if ("error" in windows) throw new Error(windows.error)
  const scope = await reportableUserIds(actor.id)
  if (!scope.workspaceId) throw new Error("This person is not in a workspace.")
  const allowed = new Set(scope.userIds)
  const who = str(input.person) ?? str(input.who)
  const team = input.team === true || input.team === "true" || (str(input.scope) ?? "").toLowerCase() === "team"
  const periodInfo = { from: windows.current.from, to: windows.current.to, ...(windows.current.isCurrent ? { daysElapsed: windows.current.daysElapsed, days: windows.current.days } : {}) }

  if (team) {
    if (scope.mode === "SELF") return { scope: "self only", note: "This person sees only their own performance (no colleagues' numbers, no team view). Offer their own instead.", period: periodInfo }
    const exempt = new Set(scope.exemptUserIds)
    let ids = scope.mode === "DIRECT_REPORTS" ? scope.directReportIds : scope.userIds.filter((id) => id !== actor.id && !exempt.has(id))
    ids = ids.filter((id) => { const left = scope.formerLeftAt.get(id); return !left || left.toISOString().slice(0, 10) >= windows.current.from })
    const reports = await buildPeopleReports({ workspaceId: scope.workspaceId, userIds: ids, current: windows.current, previous: windows.previous, detail: false })
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    const rows = users.map((u) => ({ name: u.name ?? "?", ...(reports.get(u.id) ? headline(reports.get(u.id)!.headline) : {}) }))
      .sort((a, b) => ((b as { tasksCompleted?: number }).tasksCompleted ?? 0) - ((a as { tasksCompleted?: number }).tasksCompleted ?? 0))
    const limit = Math.min(60, Math.max(1, Math.floor(Number(input.limit) || 30)))
    return {
      scope: scope.mode === "DIRECT_REPORTS" ? "your direct reports (Approval chart, one level)" : "everyone (BoD / One Above All view; BoD left out)",
      period: periodInfo,
      people: rows.length,
      items: rows.slice(0, limit),
      ...(rows.length > limit ? { more: `${rows.length - limit} more; pass limit (max 60) or ask about one person.` } : {}),
      page: `${PUBLIC_BASE}/reports`,
      note: "Task counts with several assignees are split between them (so 0.5 is possible).",
    }
  }

  let targetId = actor.id
  let targetName: string | null = actor.name ?? null
  if (who && !/^(me|saya|aku|gw|gue)$/i.test(who)) {
    const p = await findPerson(who)
    if (!allowed.has(p.id)) {
      return { scope: scope.mode === "SELF" ? "self only" : "direct reports only", note: `This person may not see ${p.name}'s performance (${scope.mode === "SELF" ? "staff see only themselves" : "a manager sees only their direct reports"}). Tell them so; do not guess numbers.` }
    }
    targetId = p.id
    targetName = p.name
  }
  const reports = await buildPeopleReports({ workspaceId: scope.workspaceId, userIds: [targetId], current: windows.current, previous: windows.previous, detail: true })
  const d = reports.get(targetId)
  if (!d) throw new Error("No report for that person in this period.")
  return {
    person: targetId === actor.id ? "you" : targetName,
    period: periodInfo,
    ...personDetail(d),
    ...(targetId === actor.id ? { leaderboard: await leaderboard(actor.id) } : {}),
    page: `${PUBLIC_BASE}/reports/${targetId}`,
    note: "Task counts with several assignees are split between them. XP and pax are plain numbers (no Rp).",
  }
}

export const performanceTools: Record<string, ExtraTool> = {
  get_performance: { read: getPerformance, stepArg: (i) => (i.team === true ? "team" : str(i.person) ?? null) },
}
