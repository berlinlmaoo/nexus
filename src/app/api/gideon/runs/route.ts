export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { isAdminOrOrgBodPlus } from "@/lib/org"
import { runRowView } from "@/lib/gideon-schedule-api"

/**
 * GIDEON run log ("Insights", 12 Oct 2026): time, trigger, status, tools used, error.
 *  - without projectId: BoD / One Above All / system admin — every run;
 *  - with projectId: that project's leads (and the above) — the runs scoped to the project.
 * Privacy as in Control Room › GIDEON: what somebody asked in a CHAT is theirs. Other people's chat runs
 * show as "Chat" with no title; mentions, digests and tickets keep theirs (those happen in shared places).
 * ?trigger= ?status= ?before=<ISO> ?limit= (≤ 200)
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const projectId = sp.get("projectId") || ""
  const bod = await isAdminOrOrgBodPlus(session.user.id)
  if (projectId) {
    if (!bod && !(await checkProjectAccess(session.user.id, projectId, ["LEAD"])).allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  } else if (!bod) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const trigger = sp.get("trigger") || ""
  const status = sp.get("status") || ""
  const before = sp.get("before")
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 50))
  const where = {
    ...(projectId ? { projectId } : {}),
    ...(trigger ? { trigger } : {}),
    ...(status ? { status } : {}),
    ...(before && !Number.isNaN(Date.parse(before)) ? { startedAt: { lt: new Date(before) } } : {}),
  }
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [rows, totals] = await Promise.all([
    prisma.gideonRun.findMany({ where, orderBy: { startedAt: "desc" }, take: limit }),
    prisma.gideonRun.groupBy({ by: ["status"], where: { ...(projectId ? { projectId } : {}), startedAt: { gte: since } }, _count: { _all: true } }),
  ])
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true, avatar: true } })
  const people = await prisma.gideonRun.findMany({ where: { ...(projectId ? { projectId } : {}), startedAt: { gte: since }, userId: { not: null } }, distinct: ["userId"], select: { userId: true } })
  const count = (s: string) => totals.find((t) => t.status === s)?._count._all ?? 0
  const done = count("SUCCEEDED") + count("FAILED")
  return NextResponse.json({
    runs: rows.map((r) => runRowView(r, users, session.user!.id!)),
    totals: {
      days: 30,
      runs: count("SUCCEEDED") + count("FAILED") + count("RUNNING"),
      failures: count("FAILED"),
      completionRate: done ? Math.round((count("SUCCEEDED") / done) * 1000) / 10 : null,
      activeUsers: people.length,
    },
  })
}
