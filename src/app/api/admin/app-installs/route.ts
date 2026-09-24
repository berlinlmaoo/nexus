export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { GIDEON_EMAIL } from "@/lib/gideon-identity"

/**
 * Who has the app, and which build they are on.
 *
 * BoD and above. Reads DeviceInstallation, which has always known who installed what — the version
 * columns are new, so anyone who has not opened a build that reports them shows as unknown rather
 * than as a guess.
 */
async function isBoD(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role === "ADMIN") return true
  const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { role: true } })
  return memberships.some((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL")
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Scoped to the viewer's workspace, and the whole roster rather than only phones: the people who
    // never installed the app are the ones a BoD needs to chase, and a list of devices cannot show an
    // absence. Primary workspace = oldest membership, as everywhere else.
    const primary = await prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
      orderBy: { joinedAt: "asc" },
      select: { workspaceId: true },
    })
    const members = primary
      ? await prisma.workspaceMember.findMany({
          where: { workspaceId: primary.workspaceId, user: { email: { not: GIDEON_EMAIL } } },
          select: { role: true, joinedAt: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
        })
      : []
    const memberIds = new Set(members.map((m) => m.user.id))

    const rows = await prisma.deviceInstallation.findMany({
      where: { disabledAt: null, ...(primary ? { userId: { in: [...memberIds] } } : {}) },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        appVersion: true,
        buildNumber: true,
        osVersion: true,
        deviceModel: true,
        environment: true,
        lastSeenAt: true,
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    })

    // One row per person, keeping their most recently seen device: the question is "who is on which
    // build", not "how many phones does everybody own".
    const byUser = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      if (!byUser.has(row.user.id)) byUser.set(row.user.id, row)
    }
    const installs = [...byUser.values()]

    // Members with no active device. "Last active" comes from their sessions (web or app), so a BoD can
    // tell "uses the web, never installed" from "has not signed in at all".
    const missing = members.filter((m) => !byUser.has(m.user.id))
    const lastActive = missing.length
      ? await prisma.userSession.groupBy({
          by: ["userId"],
          where: { userId: { in: missing.map((m) => m.user.id) } },
          _max: { lastActiveAt: true },
        })
      : []
    const lastActiveBy = new Map(lastActive.map((r) => [r.userId, r._max.lastActiveAt]))
    const notInstalled = missing
      .map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatar: m.user.avatar,
        role: m.role,
        joinedAt: m.joinedAt,
        lastActiveAt: lastActiveBy.get(m.user.id) ?? null,
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))

    const versions = new Map<string, number>()
    for (const i of installs) {
      const key = i.appVersion ? `${i.appVersion}${i.buildNumber ? ` (${i.buildNumber})` : ""}` : "unknown"
      versions.set(key, (versions.get(key) ?? 0) + 1)
    }

    return NextResponse.json({
      installs,
      notInstalled,
      totals: {
        people: installs.length,
        devices: rows.length,
        members: members.length,
        notInstalled: notInstalled.length,
        versions: [...versions.entries()]
          .map(([version, count]) => ({ version, count }))
          .sort((a, b) => b.count - a.count),
      },
    })
  } catch (error) {
    console.error("app installs error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
