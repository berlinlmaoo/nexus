import { wibDay } from "@/lib/calendar/core"
import { dayOf, hm, humanDay, todayWib, wibAt } from "@/lib/gideon-dates"
import { BOOKING_ROOMS, resolveRoomName } from "@/lib/room-booking-rooms"

/**
 * What a GIDEON book_room call asks for, read without the database (so gideon-runs.ts can describe the card
 * and decide the approval from it). The booking itself is lib/gideon-book-room.ts.
 */

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/** Longest booking GIDEON makes. */
const MAX_BOOKING_MS = 12 * 3_600_000

export type BookRoomPlan = {
  title: string
  day: string
  start: Date
  end: Date
  /** The room to book: the one named (or chosen on the card). Null = the person picks it on the card. */
  room: string | null
  /** What the person said, when it did not name exactly one room. */
  requestedRoom: string | null
  /** The rooms that name could mean (two or more = ambiguous). */
  candidates: string[]
}

/** The booking a book_room call describes; refuses what can never be booked (no title, no time, bad range). */
export function planBookRoom(raw: Record<string, unknown>, now: Date = new Date()): BookRoomPlan {
  // start_time → startTime: the model's spellings vary (tools route normalizeToolInput does the same).
  const input: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw ?? {})) input[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v
  const today = todayWib(now)
  const title = str(input.title) ?? str(input.purpose)
  if (!title) throw new Error("title is required (what the room is for)")
  let start: Date
  let end: Date
  if (str(input.startsAt) && str(input.endsAt)) {
    start = new Date(String(input.startsAt))
    end = new Date(String(input.endsAt))
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Invalid startsAt/endsAt")
  } else {
    const day = dayOf(input.date, today)
    if (!day) throw new Error("date is required (YYYY-MM-DD)")
    const startTime = str(input.start) ?? str(input.startTime) ?? str(input.time)
    if (!startTime) throw new Error("start is required (HH:mm, WIB)")
    start = wibAt(day, startTime)
    const endTime = str(input.end) ?? str(input.endTime)
    const minutes = typeof input.durationMinutes === "number" && input.durationMinutes > 0 ? input.durationMinutes : 60
    end = endTime ? wibAt(day, endTime) : new Date(start.getTime() + minutes * 60_000)
  }
  if (end <= start) throw new Error("The end must be after the start")
  if (end.getTime() - start.getTime() > MAX_BOOKING_MS) throw new Error("A booking can be at most 12 hours")
  const r = resolveRoomName(input.room)
  return {
    title: title.slice(0, 300), day: wibDay(start), start, end,
    room: r.room, requestedRoom: r.room ? null : (str(input.room) ?? null), candidates: r.candidates,
  }
}

/** One room picked on the card, and the slot (a free-slot chip may have moved it). */
export type BookRoomChoice = { room: string; startsAt: string; endsAt: string }

/** A choice sent with Apply, checked: a known room and a real slot of at most 12 hours. Null when it is not one. */
export function parseBookRoomChoice(raw: unknown): BookRoomChoice | null {
  if (!raw || typeof raw !== "object") return null
  const c = raw as Record<string, unknown>
  const room = typeof c.room === "string" ? c.room : ""
  if (!BOOKING_ROOMS.includes(room)) return null
  const start = new Date(String(c.startsAt ?? ""))
  const end = new Date(String(c.endsAt ?? ""))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end.getTime() - start.getTime() > MAX_BOOKING_MS) return null
  return { room, startsAt: start.toISOString(), endsAt: end.toISOString() }
}

/**
 * What the booking card draws (GideonProposalView.booking). The availability of each room is NOT here: it changes
 * by the minute, so the card reads GET /api/room-bookings/availability and the server checks again on Apply.
 */
export type GideonBookingView = {
  title: string
  day: string
  dayLabel: string
  start: string
  end: string
  startsAt: string
  endsAt: string
  /** Named (and so preselected), or null: the person picks on the card. */
  room: string | null
  requestedRoom: string | null
  candidates: string[]
  /** Once applied: the booking made, for the link to Room Booking. */
  bookingId?: string | null
}

export function bookingView(input: unknown, bookingId: string | null = null): GideonBookingView | null {
  if (!input || typeof input !== "object") return null
  try {
    const p = planBookRoom(input as Record<string, unknown>)
    return {
      title: p.title, day: p.day, dayLabel: humanDay(p.day, "en"), start: hm(p.start), end: hm(p.end),
      startsAt: p.start.toISOString(), endsAt: p.end.toISOString(),
      room: p.room, requestedRoom: p.requestedRoom, candidates: p.candidates,
      ...(bookingId ? { bookingId } : {}),
    }
  } catch {
    return null
  }
}

/** Old apps have no room picker: the card they draw says where to finish it, in both languages. */
export const BOOK_ROOM_LATEST_APP = "Open on the latest app or the web to choose a room · Buka di app terbaru atau web untuk memilih ruangan"

// ── Moving and cancelling a booking (16 Oct 2026) ─────────────────────────────────────────────────────

/** Old apps do not know these cards: what they show instead, and answer when Apply is tapped there. */
export const MOVE_BOOKING_LATEST_APP = "Open on the latest app or the web to move this booking · Buka di app terbaru atau web untuk memindahkan booking ini"
export const CANCEL_BOOKING_LATEST_APP = "Open on the latest app or the web to cancel this booking · Buka di app terbaru atau web untuk membatalkan booking ini"

export const BOOKING_CHANGE_ACTIONS = new Set(["move_room_booking", "cancel_room_booking"])

/** A booking as the move/cancel card shows its "before" (stored with the proposal when it was made). */
export type BookingSnapshot = { room: string; title: string; startsAt: string; endsAt: string; bookedBy: string | null }

function camel(raw: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw ?? {})) input[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v
  return input
}

/** The booking a move/cancel call names. */
export function bookingIdOf(raw: Record<string, unknown>): string {
  const id = str(camel(raw).bookingId) ?? str(camel(raw).id)
  if (!id) throw new Error("bookingId is required (from nexus_list_room_bookings)")
  return id
}

export type MoveRoomPlan = {
  bookingId: string
  title: string
  day: string
  start: Date
  end: Date
  /** The room after the move: the named one, or the booking's own when none was named. Null = picked on the card. */
  room: string | null
  requestedRoom: string | null
  candidates: string[]
  roomChanged: boolean
  timeChanged: boolean
}

/**
 * Where a move_room_booking call puts the booking, from the booking as it is now: a new room and/or a new
 * time. What is not given stays: no room = the same room; a new day only = the same times that day; a new
 * start only = the same length; startsAt/endsAt (the card's choice) = exactly that. A move that changes
 * nothing, ends in the past, or is longer than 12 hours is refused.
 */
export function planMoveRoom(
  raw: Record<string, unknown>,
  current: { room: string; title: string; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): MoveRoomPlan {
  const input = camel(raw)
  const bookingId = bookingIdOf(raw)
  const today = todayWib(now)
  const length = current.endsAt.getTime() - current.startsAt.getTime()
  const minutes = typeof input.durationMinutes === "number" && input.durationMinutes > 0 ? input.durationMinutes : null
  let start: Date
  let end: Date
  if (str(input.startsAt)) {
    start = new Date(String(input.startsAt))
    end = str(input.endsAt) ? new Date(String(input.endsAt)) : new Date(start.getTime() + (minutes ? minutes * 60_000 : length))
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Invalid startsAt/endsAt")
  } else {
    const day = dayOf(input.date, today) ?? wibDay(current.startsAt)
    const startTime = str(input.start) ?? str(input.startTime) ?? str(input.time) ?? hm(current.startsAt)
    start = wibAt(day, startTime)
    const endTime = str(input.end) ?? str(input.endTime)
    end = endTime ? wibAt(day, endTime) : new Date(start.getTime() + (minutes ? minutes * 60_000 : length))
  }
  if (end <= start) throw new Error("The end must be after the start")
  if (end.getTime() - start.getTime() > MAX_BOOKING_MS) throw new Error("A booking can be at most 12 hours")
  if (end.getTime() <= now.getTime()) throw new Error("That time has already passed. Nothing was moved.")

  const named = str(input.room)
  const r = named ? resolveRoomName(named) : { room: current.room, candidates: [current.room] }
  if (named && !r.room && r.candidates.length === 0) {
    throw new Error(`Unknown room: ${named}. Rooms: ${BOOKING_ROOMS.join(", ")}`)
  }
  const timeChanged = start.getTime() !== current.startsAt.getTime() || end.getTime() !== current.endsAt.getTime()
  const roomChanged = r.room !== current.room
  if (!timeChanged && r.room === current.room) throw new Error("That is where the booking already is: nothing would change.")
  return {
    bookingId, title: current.title, day: wibDay(start), start, end,
    room: r.room, requestedRoom: r.room ? null : (named ?? null), candidates: r.candidates,
    roomChanged, timeChanged,
  }
}

/** move_room_booking: a room named that could be more than one room → the person picks it on the card. */
export function moveNeedsPick(raw: Record<string, unknown>): boolean {
  const named = str(camel(raw).room)
  return Boolean(named && !resolveRoomName(named).room)
}

/** The choice a move card sends with Apply: the booking it is for, a known room, a real slot. */
export type MoveBookingChoice = BookRoomChoice & { bookingId: string }

export function parseMoveChoice(raw: unknown, bookingId: string): MoveBookingChoice | null {
  const base = parseBookRoomChoice(raw)
  if (!base || (raw as Record<string, unknown>).bookingId !== bookingId) return null
  return { ...base, bookingId }
}

/** A cancel card sends the booking it is for: that is how the server knows the card was understood. */
export function parseCancelChoice(raw: unknown, bookingId: string): boolean {
  return Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).bookingId === bookingId)
}

type SlotView = { room: string; day: string; dayLabel: string; start: string; end: string; startsAt: string; endsAt: string }

function slotView(room: string, startsAt: Date, endsAt: Date): SlotView {
  const day = wibDay(startsAt)
  return { room, day, dayLabel: humanDay(day, "en"), start: hm(startsAt), end: hm(endsAt), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

/**
 * What the move / cancel card draws (GideonProposalView.bookingChange). `before` is the booking when the card
 * was made. A move's `after` is where it goes: its room may be null (picked on the card, like book_room) and
 * the card reads the rooms' availability live, leaving this booking out (excludeBookingId).
 */
export type GideonBookingChangeView = {
  kind: "move" | "cancel"
  bookingId: string
  title: string
  bookedBy: string | null
  before: SlotView
  after: (Omit<SlotView, "room"> & { room: string | null; requestedRoom: string | null; candidates: string[] }) | null
  /** Applied: the move landed here (room and slot as booked). */
  applied?: SlotView | null
}

export function bookingChangeView(action: string, input: unknown, result?: unknown): GideonBookingChangeView | null {
  if (!input || typeof input !== "object" || !BOOKING_CHANGE_ACTIONS.has(action)) return null
  try {
    const i = input as Record<string, unknown>
    const b = i.before as BookingSnapshot | undefined
    if (!b || typeof b.room !== "string") return null
    const current = { room: b.room, title: b.title, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) }
    const bookingId = bookingIdOf(i)
    const before = slotView(b.room, current.startsAt, current.endsAt)
    const r = (result ?? null) as { booking?: { room?: string; startsAt?: string; endsAt?: string } } | null
    const applied = r?.booking?.room && r.booking.startsAt && r.booking.endsAt ? slotView(r.booking.room, new Date(r.booking.startsAt), new Date(r.booking.endsAt)) : null
    if (action === "cancel_room_booking") return { kind: "cancel", bookingId, title: b.title, bookedBy: b.bookedBy ?? null, before, after: null }
    // The card's "after" never fails on a slot that has since passed: it is shown, and Apply refuses it.
    const p = planMoveRoom(i, current, new Date(0))
    const after = { ...slotView(p.room ?? "", p.start, p.end), room: p.room, requestedRoom: p.requestedRoom, candidates: p.candidates }
    return { kind: "move", bookingId, title: b.title, bookedBy: b.bookedBy ?? null, before, after, ...(applied ? { applied } : {}) }
  } catch {
    return null
  }
}
