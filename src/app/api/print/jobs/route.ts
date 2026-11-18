export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { isOrgBodPlus } from "@/lib/org"
import { logScope } from "@/lib/print/access"
import { printingStatus } from "@/lib/print/config"
import { refreshJob, serializeJob } from "@/lib/print/service"

/**
 * GET /api/print/jobs — the print log (owner, 18 Nov 2026): your own prints; BoD / One Above All see everyone's.
 *   ?userId=  (BoD/OAA: one person; anyone else: only their own id, else 403)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (days in WIB, both inclusive)   ?cursor=<job id>  ?limit= (1–100, default 50)
 *   200 { jobs: [{ id, kind, refId, title, pages, copies, colorMode, status, ippJobId, error, createdAt, finishedAt,
 *                 userId, user: { id, name, avatar } }],
 *         nextCursor: string | null, canSeeAll: boolean, people: [{ id, name, avatar }] (BoD/OAA: everyone who printed),
 *         printing: { enabled, printerName, maxCopies, maxPages } }
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const sp = req.nextUrl.searchParams
    const seesAll = await isOrgBodPlus(me)
    const scope = logScope(me, seesAll, sp.get("userId"))
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const where: Prisma.PrintJobWhereInput = { ...scope }
    const from = sp.get("from")
    const to = sp.get("to")
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return NextResponse.json({ error: "Dates are YYYY-MM-DD" }, { status: 400 })
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(`${from}T00:00:00+07:00`) } : {}),
        ...(to ? { lt: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86_400_000) } : {}),
      }
    }
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50))
    const cursor = sp.get("cursor")
    let rows = await prisma.printJob.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    const nextCursor = rows.length > limit ? rows[limit - 1].id : null
    rows = rows.slice(0, limit)
    // A few jobs still marked printing: ask the printer now (cheap; the request after a deploy finds them).
    const stale = rows.filter((r) => r.status === "printing" && Date.now() - r.createdAt.getTime() > 5000).slice(0, 5)
    if (stale.length) {
      const fresh = new Map((await Promise.all(stale.map(refreshJob))).map((r) => [r.id, r]))
      rows = rows.map((r) => fresh.get(r.id) ?? r)
    }

    const userIds = Array.from(new Set(rows.map((r) => r.userId)))
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, avatar: true } })
    const byId = new Map(users.map((u) => [u.id, u]))
    let people: Array<{ id: string; name: string; avatar: string | null }> = []
    if (seesAll) {
      const ids = (await prisma.printJob.findMany({ distinct: ["userId"], select: { userId: true } })).map((r) => r.userId)
      people = (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatar: true }, orderBy: { name: "asc" } }))
    }
    return NextResponse.json({
      jobs: rows.map((r) => serializeJob(r, byId.get(r.userId) ?? null)),
      nextCursor,
      canSeeAll: seesAll,
      people,
      printing: printingStatus(),
    })
  } catch (error) {
    console.error("Error listing print jobs:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
