import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma"
import { BOOKING_ROOMS, ROOM_CAPACITY } from "@/lib/room-booking-rooms"
import { createInAppNotification, roomName } from "@/lib/notification-service"
import { bi } from "@/lib/notification-text"
import { formatBookingSlot } from "@/lib/room-booking-format"

/**
 * Room Booking — the one path that makes a booking (POST /api/room-bookings and GIDEON book_room), and the
 * reads both need: a slot's conflict, the nearest free slots around it, and every room's availability for
 * one slot (the room picker on GIDEON's card).
 *
 * Double booking is refused twice: the findFirst below gives the friendly 409 in the ordinary case, and the
 * database's exclusion constraint RoomBooking_no_overlap (prisma/sql/2026-10-16-room-booking-no-overlap.sql)
 * refuses the second of two requests that passed that check at the same moment. Both end as the same
 * 409 ROOM_TAKEN.
 */

export const bookingInclude = {
  createdBy: { select: { id: true, name: true, email: true, avatar: true } },
} as const

export type BookingWithCreator = Prisma.RoomBookingGetPayload<{ include: typeof bookingInclude }>

const MIN = 60_000
/** Free slots are offered on this grid, this far either side of the asked start, on the same WIB day. */
export const FREE_SLOT_STEP_MS = 30 * MIN
export const FREE_SLOT_WINDOW_MS = 120 * MIN
const WIB_OFFSET_MS = 7 * 60 * MIN
const DAY_MS = 24 * 60 * MIN

/** The WIB day [start, end) an instant falls in. */
function wibDayBounds(d: Date): { start: Date; end: Date } {
  const start = Math.floor((d.getTime() + WIB_OFFSET_MS) / DAY_MS) * DAY_MS - WIB_OFFSET_MS
  return { start: new Date(start), end: new Date(start + DAY_MS) }
}

/**
 * The database refused an overlapping ACTIVE booking (SQLSTATE 23P01, constraint RoomBooking_no_overlap).
 * Prisma's driver adapter carries the Postgres code a few levels down and in different places by version,
 * so the error is searched, not read at one path.
 */
export function isRoomOverlapViolation(err: unknown): boolean {
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number): boolean => {
    if (!v || typeof v !== "object" || depth > 5 || seen.has(v)) return false
    seen.add(v)
    const o = v as Record<string, unknown>
    if (o.code === "23P01" || o.originalCode === "23P01") return true
    if (typeof o.message === "string" && /RoomBooking_no_overlap|violates exclusion constraint/.test(o.message)) return true
    return ["cause", "meta", "driverAdapterError", "error"].some((k) => walk(o[k], depth + 1))
  }
  return walk(err, 0)
}

type Slot = { start: Date; end: Date }
const overlaps = (a: Slot, b: { startsAt: Date; endsAt: Date }) => a.start < b.endsAt && b.startsAt < a.end

/** The ACTIVE booking of this room that overlaps [start, end), if any (the page's own guard). */
export function findRoomConflict(workspaceIds: string[], room: string, start: Date, end: Date, excludeId?: string) {
  return prisma.roomBooking.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      workspaceId: { in: workspaceIds },
      room,
      status: "ACTIVE",
      startsAt: { lt: end },
      endsAt: { gt: start },
    },
    include: bookingInclude,
    orderBy: { startsAt: "asc" },
  })
}

/** ACTIVE bookings of these rooms on the WIB day of `at` (plus whatever crosses into it). */
async function bookingsOfDay(workspaceIds: string[], rooms: readonly string[], at: Date, excludeId?: string) {
  const day = wibDayBounds(at)
  return prisma.roomBooking.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      workspaceId: { in: workspaceIds },
      room: { in: [...rooms] },
      status: "ACTIVE",
      startsAt: { lt: day.end },
      endsAt: { gt: day.start },
    },
    include: bookingInclude,
    orderBy: { startsAt: "asc" },
  })
}

export type FreeSlot = { startsAt: string; endsAt: string; rooms: string[] }

/**
 * The slots of the same length nearest to [start, end) — on a 30-minute grid, at most two hours either side,
 * on the same WIB day, not already over — with the rooms (of `rooms`) free in each. Closest first, earlier
 * first on a tie. The asked slot itself is not among them.
 */
export function freeSlotsAround(
  bookings: { room: string; startsAt: Date; endsAt: Date }[],
  rooms: readonly string[],
  start: Date,
  end: Date,
  now: Date = new Date(),
  max = 4,
): FreeSlot[] {
  const length = end.getTime() - start.getTime()
  if (length <= 0) return []
  const day = wibDayBounds(start)
  const out: { slot: Slot; rooms: string[]; distance: number }[] = []
  const steps = Math.floor(FREE_SLOT_WINDOW_MS / FREE_SLOT_STEP_MS)
  for (let k = -steps; k <= steps; k++) {
    if (k === 0) continue
    const s = new Date(start.getTime() + k * FREE_SLOT_STEP_MS)
    const slot = { start: s, end: new Date(s.getTime() + length) }
    if (slot.start < day.start || slot.end > day.end || slot.end <= now || slot.start.getTime() < now.getTime() - FREE_SLOT_STEP_MS) continue
    const free = rooms.filter((room) => !bookings.some((b) => b.room === room && overlaps(slot, b)))
    if (free.length) out.push({ slot, rooms: free, distance: Math.abs(k) })
  }
  return out
    .sort((a, b) => a.distance - b.distance || a.slot.start.getTime() - b.slot.start.getTime())
    .slice(0, max)
    .map((x) => ({ startsAt: x.slot.start.toISOString(), endsAt: x.slot.end.toISOString(), rooms: x.rooms }))
}

/** The nearest free slots for one room around a slot (the 409 ROOM_TAKEN answer). */
export async function nearestFreeSlots(workspaceIds: string[], room: string, start: Date, end: Date, excludeId?: string): Promise<FreeSlot[]> {
  const bookings = await bookingsOfDay(workspaceIds, [room], start, excludeId)
  return freeSlotsAround(bookings, [room], start, end)
}

export type RoomAvailability = {
  room: string
  capacity: number | null
  free: boolean
  /** The booking that holds the slot: who booked it and until when, as the Room Booking page shows it. */
  busy: { id: string; title: string; by: string | null; startsAt: string; endsAt: string } | null
}

/**
 * Every room for one slot: free, or held by whom until when. With no room free, the nearest slots (same day,
 * ±2 h) in which at least one room is.
 */
export async function roomAvailability(workspaceIds: string[], start: Date, end: Date): Promise<{ rooms: RoomAvailability[]; freeSlots: FreeSlot[] }> {
  const bookings = await bookingsOfDay(workspaceIds, BOOKING_ROOMS, start)
  const rooms = BOOKING_ROOMS.map((room): RoomAvailability => {
    const hit = bookings.find((b) => b.room === room && overlaps({ start, end }, b))
    return {
      room,
      capacity: ROOM_CAPACITY[room] ?? null,
      free: !hit,
      busy: hit ? { id: hit.id, title: hit.title, by: hit.createdBy?.name ?? null, startsAt: hit.startsAt.toISOString(), endsAt: hit.endsAt.toISOString() } : null,
    }
  })
  const freeSlots = rooms.some((r) => r.free) ? [] : freeSlotsAround(bookings, BOOKING_ROOMS, start, end)
  return { rooms, freeSlots }
}

export type CreateBookingResult =
  | { ok: true; booking: BookingWithCreator }
  | { ok: false; status: number; body: Record<string, unknown> }

/** The 409 every refusal of a taken slot answers with: the booking that holds it and the nearest free slots. */
export async function roomTakenBody(workspaceIds: string[], room: string, start: Date, end: Date, excludeId?: string): Promise<Record<string, unknown>> {
  const conflict = await findRoomConflict(workspaceIds, room, start, end, excludeId)
  const freeSlots = await nearestFreeSlots(workspaceIds, room, start, end, excludeId).catch(() => [])
  return {
    error: `${room} sudah dibooking pada jam itu${conflict ? ` (${conflict.title})` : ""}.`,
    code: "ROOM_TAKEN",
    conflict,
    freeSlots,
  }
}

/**
 * Make one booking, owned by `userId`, with every rule of the Room Booking page: a real time range, not
 * already over, and not over another ACTIVE booking of the room in any of `scopeWorkspaceIds` — refused by
 * the database too when two requests race. The owner gets the usual "Room booked" notification.
 */
export async function createRoomBooking(input: {
  userId: string
  workspaceId: string
  scopeWorkspaceIds: string[]
  room: string
  title: string
  description?: string | null
  start: Date
  end: Date
}): Promise<CreateBookingResult> {
  const { userId, workspaceId, room, start, end } = input
  const scope = input.scopeWorkspaceIds.includes(workspaceId) ? input.scopeWorkspaceIds : [workspaceId, ...input.scopeWorkspaceIds]
  const title = input.title.trim()
  if (!BOOKING_ROOMS.includes(room)) return { ok: false, status: 400, body: { error: "Unknown room", code: "UNKNOWN_ROOM" } }
  if (!title) return { ok: false, status: 400, body: { error: "Title is required" } }
  if (end <= start) return { ok: false, status: 400, body: { error: "End time must be after start time" } }
  // A booking that has already ended can't be made (QA S-13, 13 Oct 2026); one under way can.
  if (end.getTime() <= Date.now()) return { ok: false, status: 400, body: { error: "That time has already passed.", code: "BOOKING_IN_PAST" } }

  if (await findRoomConflict(scope, room, start, end)) return { ok: false, status: 409, body: await roomTakenBody(scope, room, start, end) }

  let booking: BookingWithCreator
  try {
    booking = await prisma.roomBooking.create({
      data: { workspaceId, createdById: userId, room, title, description: input.description?.trim() || null, startsAt: start, endsAt: end },
      include: bookingInclude,
    })
  } catch (error) {
    // Another request took the slot between the check above and this insert.
    if (isRoomOverlapViolation(error)) return { ok: false, status: 409, body: await roomTakenBody(scope, room, start, end) }
    throw error
  }

  // A booking is a promise about a room; the person who made it gets it in writing on their
  // phone, and the reminder before it starts (booking_soon) follows from the cron.
  await createInAppNotification({
    userId,
    type: "booking_confirmed",
    ...bi(
      [`Room booked: ${roomName(room, "en")}`, `${title} · ${formatBookingSlot(start, end, "en")}. A reminder comes before it starts.`],
      [`Ruangan dibooking: ${room}`, `${title} · ${formatBookingSlot(start, end)}. Pengingat dikirim sebelum mulai.`]
    ),
    link: "/room-booking",
    push: true,
  }).catch(() => null)

  return { ok: true, booking }
}
