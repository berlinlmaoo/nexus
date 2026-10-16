import { ROOM_BOOKING_ROOMS } from "@/lib/validations"

/**
 * The bookable rooms, and how a name someone typed ("VIP", "studio", "meeting room") becomes one of them.
 * Pure (no database), so the GIDEON approval rule can use it. The list itself is validations.ts's: the
 * Room Booking page, the TV display and GIDEON all read that one list, and a new room is added there.
 */

/** The rooms, in the order the Room Booking page lists them. */
export const BOOKING_ROOMS: readonly string[] = ROOM_BOOKING_ROOMS

/** English names, as the notifications and the web show them. */
export const ROOM_EN: Readonly<Record<string, string>> = { "Ruang Meeting VIP": "VIP Meeting Room", "Ruang Meeting": "Meeting Room", Studio: "Studio" }

/** Seats per room, for the picker. None is recorded yet; a room without a number shows none. */
export const ROOM_CAPACITY: Readonly<Record<string, number>> = {}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

/**
 * The room a typed name means: an exact name (Indonesian or English, any case), else the one room whose
 * name contains every word typed. Two or more candidates ("meeting room" = Ruang Meeting AND Ruang Meeting
 * VIP) is ambiguous and resolves to nothing — GIDEON never guesses a room.
 */
export function resolveRoomName(raw: unknown): { room: string | null; candidates: string[] } {
  if (typeof raw !== "string" || !norm(raw)) return { room: null, candidates: [] }
  const said = norm(raw).replace(/\b(the|room|ruang|ruangan|rapat)\b/g, " ").replace(/\s+/g, " ").trim()
  const names = BOOKING_ROOMS.map((room) => ({ room, names: [norm(room), norm(ROOM_EN[room] ?? room)] }))
  const exact = names.find((r) => r.names.includes(norm(raw)))
  if (exact) return { room: exact.room, candidates: [exact.room] }
  if (!said) return { room: null, candidates: [...BOOKING_ROOMS] }
  const words = said.split(" ")
  const hits = names.filter((r) => r.names.some((n) => words.every((w) => n.split(" ").includes(w)))).map((r) => r.room)
  return { room: hits.length === 1 ? hits[0] : null, candidates: hits }
}
