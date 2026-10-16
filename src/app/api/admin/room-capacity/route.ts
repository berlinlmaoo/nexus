export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { setAppSetting } from "@/lib/app-setting"
import { isOrgBodPlus } from "@/lib/org"
import { roomCapacities } from "@/lib/room-booking"
import { BOOKING_ROOMS, ROOM_CAPACITY_MAX, ROOM_CAPACITY_SETTING_KEY } from "@/lib/room-booking-rooms"

/**
 * GET/PUT /api/admin/room-capacity — seats per meeting room (AppSetting "room-capacity", 16 Oct 2026). BoD /
 * One Above All only. Takes effect on the next request, no deploy: the room availability endpoint and GIDEON's
 * room cards show a room's capacity when it has one, and nothing when it has none.
 *
 * PUT { capacity: { "<room>": <seats> | null } }: the rooms sent are set (a whole number 1..500) or cleared
 * (null / 0); the rooms not sent stay as they are. An unknown room or a bad number is refused, nothing written.
 */
async function guard(): Promise<NextResponse | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await isOrgBodPlus(userId))) return NextResponse.json({ error: "Only the BoD / One Above All can set room capacity." }, { status: 403 })
  return null
}

const payload = (capacity: Record<string, number>) => ({ rooms: BOOKING_ROOMS.map((room) => ({ room, capacity: capacity[room] ?? null })) })

export async function GET() {
  const denied = await guard()
  if (denied) return denied
  return NextResponse.json(payload(await roomCapacities()), { headers: { "Cache-Control": "private, no-store" } })
}

export async function PUT(req: NextRequest) {
  const denied = await guard()
  if (denied) return denied
  const body = (await req.json().catch(() => null)) as { capacity?: unknown } | null
  const sent = body?.capacity
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) {
    return NextResponse.json({ error: "Send { capacity: { \"<room>\": <seats> | null } }.", rooms: BOOKING_ROOMS }, { status: 400 })
  }
  const next = { ...(await roomCapacities()) }
  for (const [room, value] of Object.entries(sent as Record<string, unknown>)) {
    if (!BOOKING_ROOMS.includes(room)) return NextResponse.json({ error: `Unknown room: ${room}`, rooms: BOOKING_ROOMS }, { status: 400 })
    if (value === null || value === 0) { delete next[room]; continue }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > ROOM_CAPACITY_MAX) {
      return NextResponse.json({ error: `Capacity of ${room} must be a whole number from 1 to ${ROOM_CAPACITY_MAX}, or null to clear it.` }, { status: 400 })
    }
    next[room] = value
  }
  await setAppSetting(ROOM_CAPACITY_SETTING_KEY, next)
  return NextResponse.json(payload(next))
}
