import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { wibDay } from "@/lib/calendar/core"
import { ROOM_EN } from "@/lib/room-booking-rooms"
import { createRoomBooking, deleteRoomBooking, findManageableBooking, findRoomConflict, updateRoomBooking, type BookingWithCreator } from "@/lib/room-booking"
import { formatBookingSlot } from "@/lib/room-booking-format"
import { hm, humanDay, todayWib } from "@/lib/gideon-dates"
import {
  BOOK_ROOM_LATEST_APP, CANCEL_BOOKING_LATEST_APP, MOVE_BOOKING_LATEST_APP, bookingIdOf, planBookRoom, planMoveRoom,
  type BookingSnapshot } from "@/lib/gideon-book-room-plan"
import { PUBLIC_BASE } from "@/lib/gideon-calendar-tools"
import type { GideonDiffRow } from "@/lib/gideon-runs"

/**
 * GIDEON books a room for the person (owner, 16 Oct 2026). A write like create_task: held as a proposal in
 * "Always ask" and "Review before writing" (and in every mode when no single room was named, so the person picks
 * it on the card), booked directly only in "Don't ask" (gideon-runs.ts needsApproval). The booking goes through
 * lib/room-booking.ts, the Room Booking page's own path: same rules, the person owns it, the usual notification,
 * and a slot taken in the meantime is refused (the database refuses it too), never double-booked.
 * Moving and cancelling a booking (16 Oct 2026, move_room_booking / cancel_room_booking) follow the same approval
 * modes and go through the Room Booking page's own PATCH/DELETE path (lib/room-booking.ts updateRoomBooking /
 * deleteRoomBooking): only a booking the person may change there (theirs, or any as a manager/BoD), and a move
 * into a slot taken meanwhile is refused with the nearest free slots, by the database too.
 */

/** A refusal the apply route can act on: ROOM_TAKEN keeps the card open, with the nearest free slots. */
export class BookRoomRefusal extends Error {
  constructor(message: string, readonly code: string, readonly detail: Record<string, unknown> = {}) {
    super(message)
  }
}

async function assertCompanyMember(userId: string) {
  const m = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId: ORG_WORKSPACE_ID } }, select: { role: true } })
  if (!m) throw new BookRoomRefusal("Room Booking is only for the company workspace, and this account is not in it. Nothing was booked.", "NOT_COMPANY")
}

/** The card: the room (or "choose on the card"), the slot, the title, and the named room's conflict if it has one. */
export async function describeBookRoom(actorId: string, input: Record<string, unknown>): Promise<{ summary: string; diff: GideonDiffRow[] }> {
  await assertCompanyMember(actorId)
  const plan = planBookRoom(input)
  const slot = formatBookingSlot(plan.start, plan.end, "en")
  const diff: GideonDiffRow[] = [
    { field: "Room", to: plan.room ?? (plan.candidates.length > 1 ? `Choose: ${plan.candidates.join(" / ")}` : "Choose a room") },
    { field: "When", to: slot, toDay: plan.day },
    { field: "Title", to: plan.title },
  ]
  if (plan.room) {
    const conflict = await findRoomConflict([ORG_WORKSPACE_ID], plan.room, plan.start, plan.end)
    if (conflict) diff.push({ field: "Conflict", to: `Booked by ${conflict.createdBy?.name ?? "someone"} until ${hm(conflict.endsAt)} (“${conflict.title}”)` })
  }
  // Read by the released apps only (they draw the rows; the new card draws its own picker).
  diff.push({ field: "App", to: BOOK_ROOM_LATEST_APP })
  return { summary: `Book ${plan.room ?? "a room"} · ${slot} for “${plan.title}”`, diff }
}

/**
 * Book it, as the person, through the Room Booking page's own path. A slot taken in the meantime is refused
 * with the nearest free slots: never double-booked.
 */
export async function gideonBookRoom(actorId: string, input: Record<string, unknown>, now: Date = new Date()) {
  await assertCompanyMember(actorId)
  const plan = planBookRoom(input, now)
  if (!plan.room) {
    throw new BookRoomRefusal(
      plan.candidates.length > 1
        ? `"${plan.requestedRoom}" could be ${plan.candidates.join(" or ")}: the person chooses the room on the card. Nothing was booked.`
        : "No room was named: the person chooses the room on the card. Nothing was booked.",
      "ROOM_REQUIRED",
    )
  }
  const result = await createRoomBooking({
    userId: actorId, workspaceId: ORG_WORKSPACE_ID, scopeWorkspaceIds: [ORG_WORKSPACE_ID],
    room: plan.room, title: plan.title, start: plan.start, end: plan.end,
  })
  if (!result.ok) {
    const body = result.body as {
      error?: string; code?: string
      conflict?: { title?: string; endsAt?: Date; createdBy?: { name?: string | null } | null } | null
      freeSlots?: { startsAt: string; endsAt: string; rooms: string[] }[]
    }
    if (body.code === "ROOM_TAKEN") {
      const c = body.conflict
      const slots = (body.freeSlots ?? []).map((f) => `${hm(new Date(f.startsAt))}–${hm(new Date(f.endsAt))}`)
      const holder = c ? ` (“${c.title}”${c.createdBy?.name ? ` by ${c.createdBy.name}` : ""}${c.endsAt ? ` until ${hm(new Date(c.endsAt))}` : ""})` : ""
      throw new BookRoomRefusal(
        `${plan.room} is already booked then${holder}. Nothing was booked.${slots.length ? ` Nearest free: ${slots.join(", ")} WIB.` : ""}`,
        "ROOM_TAKEN",
        { freeSlots: body.freeSlots ?? [] },
      )
    }
    throw new BookRoomRefusal(`${body.error ?? "The booking was refused"}. Nothing was booked.`, body.code ?? "REFUSED")
  }
  const b = result.booking
  return {
    booked: true,
    booking: {
      id: b.id, room: b.room, roomEn: ROOM_EN[b.room] ?? b.room, title: b.title,
      day: wibDay(b.startsAt), dayLabel: humanDay(wibDay(b.startsAt), "en", todayWib(now)), start: hm(b.startsAt), end: hm(b.endsAt),
      startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), bookedBy: b.createdBy?.name ?? null,
    },
    url: `${PUBLIC_BASE}/room-booking?booking=${b.id}`,
    note: "Booked, as this person; it is on the Room Booking page and they got the usual confirmation. Say the room, the day (dayLabel) and the time.",
  }
}

// ── Move and cancel ───────────────────────────────────────────────────────────────────────────────────

/** The booking the person may change, or a refusal GIDEON can say. */
async function manageable(actorId: string, input: Record<string, unknown>, verb: "change" | "delete"): Promise<BookingWithCreator> {
  await assertCompanyMember(actorId)
  const id = bookingIdOf(input)
  const access = await findManageableBooking(actorId, id, verb)
  if (!access.ok) {
    if (access.status === 404) throw new BookRoomRefusal("That booking was not found (it may have been deleted). Nothing was changed.", "NOT_FOUND")
    throw new BookRoomRefusal(
      `Only the person who booked it, or a manager, can ${verb === "delete" ? "cancel" : "move"} this booking. Nothing was changed.`,
      "FORBIDDEN",
    )
  }
  if (access.booking.status !== "ACTIVE") throw new BookRoomRefusal("That booking is already cancelled. Nothing was changed.", "NOT_ACTIVE")
  return access.booking
}

function snapshotOf(b: BookingWithCreator): BookingSnapshot {
  return { room: b.room, title: b.title, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), bookedBy: b.createdBy?.name ?? null }
}

/** A card made from one state of the booking, applied after it changed: refused, the person looks again. */
function assertUnchanged(input: Record<string, unknown>, b: BookingWithCreator) {
  const before = input.before as BookingSnapshot | undefined
  if (!before) return
  if (before.room !== b.room || before.startsAt !== b.startsAt.toISOString() || before.endsAt !== b.endsAt.toISOString()) {
    throw new BookRoomRefusal(
      `That booking changed since this card was made (now ${b.room} · ${formatBookingSlot(b.startsAt, b.endsAt, "en")}). Nothing was changed; ask GIDEON again.`,
      "BOOKING_CHANGED",
    )
  }
}

function bookingOut(b: BookingWithCreator, now: Date) {
  return {
    id: b.id, room: b.room, roomEn: ROOM_EN[b.room] ?? b.room, title: b.title,
    day: wibDay(b.startsAt), dayLabel: humanDay(wibDay(b.startsAt), "en", todayWib(now)), start: hm(b.startsAt), end: hm(b.endsAt),
    startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), bookedBy: b.createdBy?.name ?? null,
  }
}

const slotOf = (room: string, start: Date, end: Date) => `${room} · ${formatBookingSlot(start, end, "en")}`

/**
 * The move card: the booking before and after (room and time), and the new slot's holder if it has one.
 * `store` goes into the proposal's input: the booking as it is now (the card's "before", checked again on
 * Apply) and the resolved new slot, so the card never re-reads a relative day ("tomorrow") on another day.
 */
export async function describeMoveRoomBooking(actorId: string, input: Record<string, unknown>, now: Date = new Date()) {
  const b = await manageable(actorId, input, "change")
  const plan = planMoveRoom(input, b, now)
  const diff: GideonDiffRow[] = [
    { field: "Booking", to: b.title },
    { field: "Room", from: b.room, to: plan.room ?? (plan.candidates.length > 1 ? `Choose: ${plan.candidates.join(" / ")}` : "Choose a room") },
    { field: "When", from: formatBookingSlot(b.startsAt, b.endsAt, "en"), to: formatBookingSlot(plan.start, plan.end, "en"), fromDay: wibDay(b.startsAt), toDay: plan.day },
  ]
  if (b.createdById !== actorId) diff.push({ field: "Booked by", to: b.createdBy?.name ?? "someone" })
  if (plan.room) {
    const conflict = await findRoomConflict([b.workspaceId], plan.room, plan.start, plan.end, b.id)
    if (conflict) diff.push({ field: "Conflict", to: `Booked by ${conflict.createdBy?.name ?? "someone"} until ${hm(conflict.endsAt)} (“${conflict.title}”)` })
  }
  diff.push({ field: "App", to: MOVE_BOOKING_LATEST_APP })
  return {
    summary: `Move “${b.title}” · ${slotOf(b.room, b.startsAt, b.endsAt)} → ${slotOf(plan.room ?? "a room", plan.start, plan.end)}`,
    diff,
    store: {
      bookingId: b.id, before: snapshotOf(b), startsAt: plan.start.toISOString(), endsAt: plan.end.toISOString(),
      ...(plan.room ? { room: plan.room } : {}),
    } as Record<string, unknown>,
  }
}

/** The cancel card: which booking, when, and whose (a manager may cancel someone else's). */
export async function describeCancelRoomBooking(actorId: string, input: Record<string, unknown>) {
  const b = await manageable(actorId, input, "delete")
  const diff: GideonDiffRow[] = [
    { field: "Booking", to: b.title },
    { field: "Room", to: b.room },
    { field: "When", to: formatBookingSlot(b.startsAt, b.endsAt, "en"), toDay: wibDay(b.startsAt) },
  ]
  if (b.createdById !== actorId) diff.push({ field: "Booked by", to: b.createdBy?.name ?? "someone" })
  diff.push({ field: "App", to: CANCEL_BOOKING_LATEST_APP })
  return {
    summary: `Cancel “${b.title}” · ${slotOf(b.room, b.startsAt, b.endsAt)}`,
    diff,
    store: { bookingId: b.id, before: snapshotOf(b) } as Record<string, unknown>,
  }
}

/**
 * Move it, as the person, through the Room Booking page's own PATCH path: a slot taken in the meantime is
 * refused with the nearest free slots (the database's exclusion constraint included), never double-booked.
 */
export async function gideonMoveRoomBooking(actorId: string, input: Record<string, unknown>, now: Date = new Date()) {
  const b = await manageable(actorId, input, "change")
  assertUnchanged(input, b)
  const plan = planMoveRoom(input, b, now)
  if (!plan.room) {
    throw new BookRoomRefusal(
      `"${plan.requestedRoom}" could be ${plan.candidates.join(" or ")}: the person chooses the room on the card. Nothing was moved.`,
      "ROOM_REQUIRED",
    )
  }
  const result = await updateRoomBooking({
    userId: actorId, bookingId: b.id,
    patch: { ...(plan.roomChanged ? { room: plan.room } : {}), ...(plan.timeChanged ? { startsAt: plan.start, endsAt: plan.end } : {}) },
  })
  if (!result.ok) {
    const body = result.body as {
      error?: string; code?: string
      conflict?: { title?: string; endsAt?: Date; createdBy?: { name?: string | null } | null } | null
      freeSlots?: { startsAt: string; endsAt: string; rooms: string[] }[]
    }
    if (body.code === "ROOM_TAKEN") {
      const c = body.conflict
      const slots = (body.freeSlots ?? []).map((f) => `${hm(new Date(f.startsAt))}–${hm(new Date(f.endsAt))}`)
      const holder = c ? ` (“${c.title}”${c.createdBy?.name ? ` by ${c.createdBy.name}` : ""}${c.endsAt ? ` until ${hm(new Date(c.endsAt))}` : ""})` : ""
      throw new BookRoomRefusal(
        `${plan.room} is already booked then${holder}. Nothing was moved.${slots.length ? ` Nearest free: ${slots.join(", ")} WIB.` : ""}`,
        "ROOM_TAKEN",
        { freeSlots: body.freeSlots ?? [] },
      )
    }
    throw new BookRoomRefusal(`${body.error ?? "The move was refused"}. Nothing was moved.`, body.code ?? "REFUSED")
  }
  return {
    moved: true,
    from: bookingOut(result.before, now),
    booking: bookingOut(result.booking, now),
    url: `${PUBLIC_BASE}/room-booking?booking=${result.booking.id}`,
    note: "Moved, as this person, on the Room Booking page; the owner was told if it is not theirs. Say the new room, day (dayLabel) and time.",
  }
}

/** Cancel it, as the person, through the Room Booking page's own DELETE path (restorable from the Audit). */
export async function gideonCancelRoomBooking(actorId: string, input: Record<string, unknown>, now: Date = new Date()) {
  const b = await manageable(actorId, input, "delete")
  assertUnchanged(input, b)
  const result = await deleteRoomBooking({ userId: actorId, bookingId: b.id, via: "gideon" })
  if (!result.ok) throw new BookRoomRefusal(`${String(result.body.error ?? "The cancellation was refused")}. Nothing was changed.`, "REFUSED")
  return {
    cancelled: true,
    booking: bookingOut(result.before, now),
    note: "Cancelled, as this person: the room is free again and the owner was told if it is not theirs. A BoD can restore it from Control Room → Audit. Say which booking and when.",
  }
}
