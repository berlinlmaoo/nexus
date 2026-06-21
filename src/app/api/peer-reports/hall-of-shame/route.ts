export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getUserOrgRole, serializeHallOfShame } from "@/lib/peer-reports"

// GET /api/peer-reports/hall-of-shame — PUBLIC to any member. Verified violations only
// (name + category + date), plus a repeat-offender tally. No reporter, no reason.
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await getUserOrgRole(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const [entries, grouped] = await Promise.all([
      prisma.peerReport.findMany({
        where: { status: "VERIFIED" },
        orderBy: { reviewedAt: "desc" },
        take: 100,
        select: { id: true, category: true, reviewedAt: true, createdAt: true, reportedUser: { select: { id: true, name: true, avatar: true } } },
      }),
      prisma.peerReport.groupBy({
        by: ["reportedUserId"],
        where: { status: "VERIFIED" },
        _count: { _all: true },
        orderBy: { _count: { reportedUserId: "desc" } },
        take: 10,
      }),
    ])

    const offenderUsers = grouped.length
      ? await prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.reportedUserId) } }, select: { id: true, name: true, avatar: true } })
      : []
    const offenders = grouped
      .map((g) => ({ user: offenderUsers.find((u) => u.id === g.reportedUserId), count: g._count._all }))
      .filter((o): o is { user: { id: string; name: string; avatar: string | null }; count: number } => Boolean(o.user))

    return NextResponse.json({ entries: entries.map(serializeHallOfShame), offenders })
  } catch (error) {
    console.error("Error fetching hall of shame:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
