import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { addDays, dayDiff, dayStartUtc, inScope, mondayOf, sundayOf, subtreeOf, wibDay, type CalItem } from "@/lib/calendar/core"
import { buildCalendarItems, calendarCallerFor, extraPeople, holidaysBetween, loadStructure, loadTaskRows, ROW_CAP } from "@/lib/calendar/server"
import { BOOKING_ROOMS, ROOM_CAPACITY, ROOM_EN, resolveRoomName } from "@/lib/room-booking-rooms"
import { bookingInclude, roomAvailability } from "@/lib/room-booking"
import { dayOf, hm, humanDay, todayWib, wibAt } from "@/lib/gideon-dates"

/**
 * GIDEON and the calendar (owner, 16 Oct 2026: "GIDEON can't even read the calendar").
 *
 *  - get_calendar: what the person's Master Calendar shows them for a range, through the SAME rules
 *    (calendarCallerFor + buildItems in lib/calendar): a task of a private project they are not in comes back
 *    as "Internal task" without title, project or id; a task nobody is doing is not there at all; someone
 *    outside the company workspace gets nothing (the Calendar's access "none").
 *  - list_room_bookings: the bookings as the Room Booking page shows them (room, time, who booked, title), the
 *    free time per room and day, and, for one slot, which rooms are free.
 *
 * Everything returned here goes to the model, so nothing in it may be more than the person can see.
 */

export const PUBLIC_BASE = (process.env.NEXUS_PUBLIC_URL || "https://nexus.znetworks.id").replace(/\/+$/, "")

/** Longest range one call may read, inclusive (the Calendar's own limit). */
export const GIDEON_RANGE_MAX_DAYS = 62
/** Free time per room is listed inside this part of the day (WIB); bookings outside it are still listed. */
const FREE_FROM_MIN = 8 * 60
const FREE_TO_MIN = 21 * 60
const MASKED_TITLE = "Internal task"

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/**
 * The days a read covers: `date` alone = that day; `from`/`to` (either may be missing); nothing = `fallback`.
 * Longer than 62 days is cut to 62 and said so.
 */
export function readRange(input: Record<string, unknown>, today: string, fallback: "week" | "today"): { from: string; to: string; capped: boolean } {
  const date = dayOf(input.date, today)
  let from = dayOf(input.from ?? input.start ?? input.startDate, today) ?? date
  let to = dayOf(input.to ?? input.end ?? input.endDate, today) ?? (date ?? null)
  if (str(input.date) && !date) throw new Error(`Invalid date: ${input.date} (use YYYY-MM-DD)`)
  if (!from && !to) {
    from = fallback === "week" ? mondayOf(today) : today
    to = fallback === "week" ? sundayOf(today) : addDays(today, 6)
  }
  if (!from) from = to!
  if (!to) to = fallback === "week" ? sundayOf(from) : from
  if (to < from) [from, to] = [to, from]
  const capped = dayDiff(from, to) + 1 > GIDEON_RANGE_MAX_DAYS
  if (capped) to = addDays(from, GIDEON_RANGE_MAX_DAYS - 1)
  return { from, to, capped }
}

// ── get_calendar ──────────────────────────────────────────────────────────────────────────────────────

export async function gideonGetCalendar(actorId: string, input: Record<string, unknown>, now: Date = new Date()) {
  const today = todayWib(now)
  const { from, to, capped } = readRange(input, today, "week")
  const base = { today, from, to, rangeCapped: capped, ...(capped ? { rangeNote: `Cut to ${GIDEON_RANGE_MAX_DAYS} days: ask for the rest separately.` } : {}) }
  const caller = await calendarCallerFor(actorId)
  if (caller.kind === "none") {
    return { ...base, access: "none", items: [], holidays: [], note: "This person is not in the company workspace, so the Calendar has nothing for them. Say so; do not guess." }
  }
  if (caller.kind === "off") {
    return { ...base, access: "off", items: [], holidays: [], note: "The Calendar is not open to this person yet. Say so; do not guess." }
  }
  const [s, { rows, truncated }, holidays] = await Promise.all([
    loadStructure(),
    loadTaskRows({ gte: dayStartUtc(from), lt: dayStartUtc(addDays(to, 1)) }, { take: ROW_CAP }),
    holidaysBetween(from, to),
  ])
  let items: CalItem[] = await buildCalendarItems(rows, caller, s)

  // Filters work on what the person may see: a masked row has no project, so a project filter drops it
  // rather than telling which private project it belongs to.
  const mine = input.mine === true || str(input.assignee)?.toLowerCase() === "me" || str(input.assigneeId) === actorId
  if (mine) items = items.filter((i) => inScope(i, "me", actorId, new Set()))
  const projectId = str(input.projectId)
  if (projectId) items = items.filter((i) => i.project?.id === projectId)
  const unitArg = str(input.unitId) ?? str(input.division) ?? str(input.unit)
  if (unitArg) {
    const lower = unitArg.toLowerCase()
    const unit = s.units.find((u) => u.id === unitArg) ?? s.units.find((u) => u.name.toLowerCase() === lower)
      ?? (s.units.filter((u) => u.name.toLowerCase().includes(lower)).length === 1 ? s.units.find((u) => u.name.toLowerCase().includes(lower)) : undefined)
    if (!unit) throw new Error(`Division not found: ${unitArg}. Divisions: ${s.units.map((u) => u.name).join(", ")}`)
    const division = subtreeOf(s.units, [unit.id])
    items = items.filter((i) => inScope(i, "division", actorId, division))
  }

  const extra = await extraPeople(items, s)
  const nameOf = (id: string) => s.people.find((p) => p.userId === id)?.name ?? extra[id]?.name ?? null
  const LIMIT = 200
  const out = items.slice(0, LIMIT).map((i) => {
    const assignees = i.assigneeIds.map(nameOf).filter((n): n is string => !!n)
    const when = { day: i.day, dayLabel: humanDay(i.day, "en", today), time: i.time }
    if (i.masked) return { masked: true, title: MASKED_TITLE, ...when, done: i.done, assignees }
    return {
      id: i.id, title: i.title, ...when, status: i.status, done: i.done, priority: i.priority,
      project: i.project?.name ?? null, projectId: i.project?.id ?? null, assignees,
      url: `${PUBLIC_BASE}/tasks/${i.id}`,
    }
  })
  return {
    ...base,
    access: caller.access,
    count: items.length,
    truncated: truncated || items.length > LIMIT,
    items: out,
    holidays,
    note: items.length
      ? `Every task here is due on these days and has someone doing it. A row with masked:true is a task of a private project this person is not in: call it "${MASKED_TITLE}" and never guess what it is. Write days as dayLabel.`
      : "Nothing is due in this range for this person's view of the Calendar. Say so plainly.",
  }
}

// ── list_room_bookings ────────────────────────────────────────────────────────────────────────────────

export async function isCompanyMember(userId: string): Promise<boolean> {
  const m = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId: ORG_WORKSPACE_ID } }, select: { role: true } })
  return !!m
}

const NOT_COMPANY = "Room Booking is for the company workspace, and this person is not in it. Say so; do not guess."

/** The room(s) a name means; a name that matches nothing is an error that lists the rooms. */
function roomsFor(raw: unknown): string[] {
  if (!str(raw)) return [...BOOKING_ROOMS]
  const r = resolveRoomName(raw)
  if (r.room) return [r.room]
  if (r.candidates.length) return r.candidates
  throw new Error(`Unknown room: ${raw}. Rooms: ${BOOKING_ROOMS.map((x) => `${x} (${ROOM_EN[x] ?? x})`).join(", ")}`)
}

export async function gideonListRoomBookings(actorId: string, input: Record<string, unknown>, now: Date = new Date()) {
  const today = todayWib(now)
  const { from, to, capped } = readRange(input, today, "today")
  const rooms = roomsFor(input.room)
  const roomList = BOOKING_ROOMS.map((room) => ({ room, en: ROOM_EN[room] ?? room, capacity: ROOM_CAPACITY[room] ?? null }))
  const base = { today, from, to, rangeCapped: capped, rooms: roomList }
  if (!(await isCompanyMember(actorId))) return { ...base, access: "none", bookings: [], note: NOT_COMPANY }

  const found = await prisma.roomBooking.findMany({
    where: { workspaceId: ORG_WORKSPACE_ID, status: "ACTIVE", room: { in: rooms }, startsAt: { lt: dayStartUtc(addDays(to, 1)) }, endsAt: { gt: dayStartUtc(from) } },
    include: bookingInclude,
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    take: 300,
  })
  const bookings = found.map((b) => ({
    id: b.id, room: b.room, roomEn: ROOM_EN[b.room] ?? b.room, title: b.title, bookedBy: b.createdBy?.name ?? null,
    day: wibDay(b.startsAt), dayLabel: humanDay(wibDay(b.startsAt), "en", today), start: hm(b.startsAt), end: hm(b.endsAt),
    startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(),
  }))

  // Free time per room and day (08:00–21:00 WIB, what is left of today), for ranges up to a week.
  const free: { day: string; dayLabel: string; room: string; free: string[] }[] = []
  if (dayDiff(from, to) < 7) {
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (day < today) continue
      const dayStart = dayStartUtc(day).getTime()
      const nowMin = day === today ? Math.ceil((now.getTime() - dayStart) / 60_000 / 15) * 15 : 0
      for (const room of rooms) {
        const taken = found
          .filter((b) => b.room === room && b.startsAt.getTime() < dayStart + 86_400_000 && b.endsAt.getTime() > dayStart)
          .map((b) => [Math.max(0, (b.startsAt.getTime() - dayStart) / 60_000), Math.min(1440, (b.endsAt.getTime() - dayStart) / 60_000)] as const)
        const gaps: string[] = []
        let cursor = Math.max(FREE_FROM_MIN, nowMin)
        for (const [s, e] of [...taken].sort((a, b) => a[0] - b[0])) {
          if (s > cursor && Math.min(s, FREE_TO_MIN) - cursor >= 15) gaps.push(`${clock(cursor)}–${clock(Math.min(s, FREE_TO_MIN))}`)
          cursor = Math.max(cursor, e)
        }
        if (FREE_TO_MIN - cursor >= 15) gaps.push(`${clock(cursor)}–${clock(FREE_TO_MIN)}`)
        free.push({ day, dayLabel: humanDay(day, "en", today), room, free: gaps })
      }
    }
  }

  // One slot asked about ("is the meeting room free tomorrow at 2?"): every room for it.
  let slot: Record<string, unknown> | undefined
  const at = str(input.time) ?? str(input.startTime)
  if (at) {
    const start = wibAt(from, at)
    const endAt = str(input.endTime)
    const minutes = typeof input.durationMinutes === "number" && input.durationMinutes > 0 ? Math.min(input.durationMinutes, 720) : 60
    const end = endAt ? wibAt(from, endAt) : new Date(start.getTime() + minutes * 60_000)
    if (end <= start) throw new Error("endTime must be after the time asked about")
    const a = await roomAvailability([ORG_WORKSPACE_ID], start, end)
    slot = {
      day: from, dayLabel: humanDay(from, "en", today), start: hm(start), end: hm(end),
      rooms: a.rooms.filter((r) => rooms.includes(r.room)).map((r) => ({
        room: r.room, roomEn: ROOM_EN[r.room] ?? r.room, free: r.free,
        ...(r.busy ? { bookedBy: r.busy.by, title: r.busy.title, until: hm(new Date(r.busy.endsAt)) } : {}),
      })),
      nearestFreeSlots: a.freeSlots.map((f) => ({ start: hm(new Date(f.startsAt)), end: hm(new Date(f.endsAt)), rooms: f.rooms })),
    }
  }

  return {
    ...base,
    access: "company",
    count: bookings.length,
    bookings,
    ...(free.length ? { freeTime: free } : {}),
    ...(slot ? { slot } : {}),
    note: "Times are WIB. This is read only: to book, use nexus_book_room; to move or cancel one of these bookings, nexus_move_room_booking / nexus_cancel_room_booking with its id.",
  }
}

function clock(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}
