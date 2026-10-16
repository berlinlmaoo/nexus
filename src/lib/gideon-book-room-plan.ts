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
