export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canSeePresence, getPresence, presenceEnabled, visibleUserIds } from "@/lib/presence"

/**
 * Presence status (owner, 19 Oct 2026). Native contract: docs/internal/presence-status-native.md.
 *   GET /api/presence                    everyone the caller shares a workspace with (themselves included)
 *   GET /api/presence?userIds=a,b,c      only these (the ones the caller may see; others are left out)
 *   GET /api/presence?userId=a           one → { enabled, status } (404 when not visible)
 * → { enabled, statuses: PresenceStatus[], serverTime }. enabled:false (remote config flags.presenceStatus off) →
 * no statuses: the apps hide every dot and label. Live updates: socket event `presence-changed` { userId, status }.
 * Read-only on attendance; location is never more than "in / out of the office".
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const viewerId = session.user.id
  const serverTime = new Date().toISOString()
  if (!(await presenceEnabled())) return NextResponse.json({ enabled: false, statuses: [], status: null, serverTime })

  const one = req.nextUrl.searchParams.get("userId")?.trim()
  if (one) {
    const id = one === "me" ? viewerId : one
    if (!(await canSeePresence(viewerId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const status = (await getPresence([id])).get(id) ?? null
    return NextResponse.json({ enabled: true, status, serverTime })
  }

  const visible = await visibleUserIds(viewerId)
  const asked = (req.nextUrl.searchParams.get("userIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  const ids = asked.length ? asked.filter((id) => visible.includes(id)) : visible
  const map = await getPresence(ids.slice(0, 2000))
  return NextResponse.json({ enabled: true, statuses: [...map.values()], serverTime })
}
