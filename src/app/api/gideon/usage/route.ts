export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

/**
 * Who uses GIDEON, and how much.
 *
 * BoD and above, matching announcements: this is a view of what colleagues have been asking an
 * assistant, and that is not everybody's business. It reports COUNTS and timestamps only — never the
 * content of anybody's conversation, which stays between them and GIDEON.
 */
async function isBoD(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role === "ADMIN") return true
  const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { role: true } })
  return memberships.some((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL")
}

type Row = {
  id: string
  name: string
  email: string | null
  avatar: string | null
  asked: bigint
  answered: bigint
  toolCalls: bigint
  firstUsed: Date | null
  lastUsed: Date | null
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // One query rather than a groupBy plus a second pass for names: the table is small, and the
    // shape the screen wants is exactly what SQL already knows how to produce.
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT u.id,
             u.name,
             u.email,
             u.avatar,
             COUNT(*) FILTER (WHERE g.role = 'user')      AS "asked",
             COUNT(*) FILTER (WHERE g.role = 'assistant') AS "answered",
             COALESCE(SUM(CARDINALITY(g.tools)), 0)       AS "toolCalls",
             MIN(g."createdAt")                           AS "firstUsed",
             MAX(g."createdAt")                           AS "lastUsed"
      FROM "GideonMessage" g
      JOIN "User" u ON u.id = g."userId"
      GROUP BY u.id, u.name, u.email, u.avatar
      ORDER BY "asked" DESC, "lastUsed" DESC
    `

    // Postgres counts arrive as BigInt, which JSON.stringify refuses outright — the route would 500
    // with a message about serialising BigInt and nothing about the numbers themselves.
    const users = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      avatar: r.avatar,
      asked: Number(r.asked),
      answered: Number(r.answered),
      toolCalls: Number(r.toolCalls),
      firstUsed: r.firstUsed,
      lastUsed: r.lastUsed,
    }))

    return NextResponse.json({
      users,
      totals: {
        people: users.length,
        asked: users.reduce((sum, u) => sum + u.asked, 0),
        toolCalls: users.reduce((sum, u) => sum + u.toolCalls, 0),
      },
    })
  } catch (error) {
    console.error("gideon usage error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
