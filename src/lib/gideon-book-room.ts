import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { wibDay } from "@/lib/calendar/core"
import { ROOM_EN } from "@/lib/room-booking-rooms"
import { createRoomBooking, findRoomConflict } from "@/lib/room-booking"
import { formatBookingSlot } from "@/lib/room-booking-format"
import { hm, humanDay, todayWib } from "@/lib/gideon-dates"
import { BOOK_ROOM_LATEST_APP, planBookRoom } from "@/lib/gideon-book-room-plan"
import { PUBLIC_BASE } from "@/lib/gideon-calendar-tools"
import type { GideonDiffRow } from "@/lib/gideon-runs"

/**
 * GIDEON books a room for the person (owner, 16 Oct 2026). A write like create_task: held as a proposal in
 * "Always ask" and "Review before writing" (and in every mode when no single room was named, so the person picks
 * it on the card), booked directly only in "Don't ask" (gideon-runs.ts needsApproval). The booking goes through
 * lib/room-booking.ts, the Room Booking page's own path: same rules, the person owns it, the usual notification,
 * and a slot taken in the meantime is refused (the database refuses it too), never double-booked.
 * Cancelling or moving a booking is not GIDEON's yet.
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
