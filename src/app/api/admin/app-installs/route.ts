export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

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

    const rows = await prisma.deviceInstallation.findMany({
      where: { disabledAt: null },
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

    const versions = new Map<string, number>()
    for (const i of installs) {
      const key = i.appVersion ? `${i.appVersion}${i.buildNumber ? ` (${i.buildNumber})` : ""}` : "unknown"
      versions.set(key, (versions.get(key) ?? 0) + 1)
    }

    return NextResponse.json({
      installs,
      totals: {
        people: installs.length,
        devices: rows.length,
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
