export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { cardFromResult, proposalView } from "@/lib/gideon-runs"
import { markAiFill } from "@/lib/gideon-autofill"
import {
  BOOK_ROOM_LATEST_APP, CANCEL_BOOKING_LATEST_APP, MOVE_BOOKING_LATEST_APP, parseBookRoomChoice, parseCancelChoice,
  parseMoveChoice } from "@/lib/gideon-book-room-plan"
import { formatBookingSlot } from "@/lib/room-booking-format"
import type { Prisma } from "@/generated/prisma"

const DELETE_TASK_LATEST_APP = "Open on the latest app or the web to delete this task · Buka di app terbaru atau web untuk menghapus task ini"

/** A proposal older than this is not applied: the task it describes has likely moved on. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * POST /api/gideon/proposals/:id  { decision: "apply" | "discard" }
 *
 * Apply runs the SAME /api/gideon/tools action GIDEON would have run, as the same person (service token
 * + x-gideon-actor), so every access check runs again at the moment of applying — approving a change
 * never grants more than the person has now. The claim PENDING → APPLYING is a conditional update, so a
 * double tap applies once.
 *
 * book_room (16 Oct 2026) also takes `booking: { room, startsAt, endsAt }`, the room (and slot) picked on the card.
 * Without it the proposal cannot be applied: that is a client without the room picker (a released app), which is
 * answered with "open on the latest app or the web" and the proposal stays waiting. A slot taken meanwhile is
 * refused by the booking itself (re-checked, and by the database); the card stays open with the error and the
 * nearest free slots, so another room or time can be picked.
 *
 * move_room_booking / cancel_room_booking (16 Oct 2026) the same way: a move takes `booking: { bookingId, room,
 * startsAt, endsAt }` (the room and slot on the card), a cancel `booking: { bookingId }`. Without it — a released
 * app, which draws these as plain rows — the answer is "open on the latest app or the web" and the proposal stays
 * waiting. A move into a slot taken meanwhile keeps the card open, like a booking.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { decision?: string; booking?: unknown; confirm?: unknown }
  const decision = body.decision === "apply" ? "apply" : body.decision === "discard" ? "discard" : null
  if (!decision) return NextResponse.json({ error: "decision must be apply or discard" }, { status: 400 })

  const proposal = await prisma.gideonProposal.findUnique({ where: { id } })
  if (!proposal || proposal.userId !== session.user.id) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (proposal.status !== "PENDING") return NextResponse.json({ error: "Already decided", proposal: proposalView(proposal) }, { status: 409 })

  if (decision === "discard") {
    const updated = await prisma.gideonProposal.update({ where: { id }, data: { status: "DISCARDED", decidedAt: new Date() } })
    return NextResponse.json({ proposal: proposalView(updated) })
  }

  if (Date.now() - proposal.createdAt.getTime() > MAX_AGE_MS) {
    const updated = await prisma.gideonProposal.update({ where: { id }, data: { status: "FAILED", error: "Expired: ask GIDEON again.", decidedAt: new Date() } })
    return NextResponse.json({ error: "Expired", proposal: proposalView(updated) }, { status: 410 })
  }

  if (proposal.action === "move_room_booking" || proposal.action === "cancel_room_booking") {
    const stored = (proposal.input as Record<string, unknown>) ?? {}
    const bookingId = typeof stored.bookingId === "string" ? stored.bookingId : ""
    const isMove = proposal.action === "move_room_booking"
    const choice = isMove ? parseMoveChoice(body.booking, bookingId) : null
    if (!bookingId || (isMove ? !choice : !parseCancelChoice(body.booking, bookingId))) {
      const latest = isMove ? MOVE_BOOKING_LATEST_APP : CANCEL_BOOKING_LATEST_APP
      const view = { ...proposalView(proposal), status: "FAILED", error: latest }
      return NextResponse.json({ error: latest, code: "NEEDS_LATEST_APP", proposal: view }, { status: 409 })
    }
    if (choice) {
      const input: Record<string, unknown> = { ...stored, room: choice.room, startsAt: choice.startsAt, endsAt: choice.endsAt }
      for (const k of ["date", "start", "end", "startTime", "endTime", "time", "durationMinutes"]) delete input[k]
      const before = stored.before as { room?: string; startsAt?: string; endsAt?: string; title?: string } | undefined
      const from = before?.startsAt && before.endsAt ? `${before.room} · ${formatBookingSlot(new Date(before.startsAt), new Date(before.endsAt), "en")}` : ""
      const to = `${choice.room} · ${formatBookingSlot(new Date(choice.startsAt), new Date(choice.endsAt), "en")}`
      await prisma.gideonProposal.updateMany({
        where: { id, status: "PENDING" },
        data: { input: input as Prisma.InputJsonValue, summary: `Move “${before?.title ?? ""}” · ${from} → ${to}`.slice(0, 300) },
      })
    }
  }

  // delete_task (owner, 18 Oct 2026): only the destructive card applies it, and it sends the task id back
  // (`confirm: { taskId }`). A client without that card — a released app drawing plain rows — is told to open the
  // latest app or the web, and the proposal stays waiting: a delete is never applied from a card that did not say so.
  if (proposal.action === "delete_task") {
    const stored = (proposal.input as Record<string, unknown>) ?? {}
    const confirm = body.confirm && typeof body.confirm === "object" ? (body.confirm as Record<string, unknown>) : null
    if (!stored.taskId || confirm?.taskId !== stored.taskId) {
      const view = { ...proposalView(proposal), status: "FAILED", error: DELETE_TASK_LATEST_APP }
      return NextResponse.json({ error: DELETE_TASK_LATEST_APP, code: "NEEDS_LATEST_APP", proposal: view }, { status: 409 })
    }
  }

  if (proposal.action === "book_room") {
    const choice = parseBookRoomChoice(body.booking)
    if (!choice) {
      // Not stored: the proposal stays PENDING for the web or an app that has the picker.
      const view = { ...proposalView(proposal), status: "FAILED", error: BOOK_ROOM_LATEST_APP }
      return NextResponse.json({ error: BOOK_ROOM_LATEST_APP, code: "NEEDS_LATEST_APP", proposal: view }, { status: 409 })
    }
    // The chosen room and slot become the proposal's input, so what runs is exactly what the card showed.
    const input: Record<string, unknown> = { ...((proposal.input as Record<string, unknown>) ?? {}), room: choice.room, startsAt: choice.startsAt, endsAt: choice.endsAt }
    const slot = formatBookingSlot(new Date(choice.startsAt), new Date(choice.endsAt), "en")
    const title = typeof input.title === "string" ? input.title : ""
    await prisma.gideonProposal.updateMany({
      where: { id, status: "PENDING" },
      data: { input: input as Prisma.InputJsonValue, summary: `Book ${choice.room} · ${slot} for “${title}”`.slice(0, 300) },
    })
  }

  const claimed = await prisma.gideonProposal.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPLYING" } })
  if (claimed.count === 0) return NextResponse.json({ error: "Already decided" }, { status: 409 })

  const token = process.env.NEXUS_GIDEON_SERVICE_TOKEN
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } })
  let ok = false
  let data: unknown = null
  let message: string | null = null
  let code: string | null = null
  let freeSlots: unknown = null
  try {
    if (!token) throw new Error("GIDEON is not configured on this server")
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/gideon/tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-gideon-actor": me?.email || session.user.id,
        "x-gideon-approved": id,
      },
      body: JSON.stringify({ action: proposal.action, input: {} }),
      signal: AbortSignal.timeout(30_000),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: string; code?: string; freeSlots?: unknown } | null
    ok = Boolean(res.ok && json?.ok)
    data = json?.data ?? null
    message = ok ? null : (typeof json?.error === "string" ? json.error : `Failed (${res.status})`)
    code = typeof json?.code === "string" ? json.code : null
    freeSlots = json?.freeSlots ?? null
  } catch (error) {
    message = error instanceof Error ? error.message : "Failed"
  }

  // The room was taken between the card and the tap: refused (never double-booked), and the card stays open with
  // the reason so another room or time can be picked.
  if (!ok && (proposal.action === "book_room" || proposal.action === "move_room_booking") && code === "ROOM_TAKEN") {
    const reopened = await prisma.gideonProposal.update({ where: { id }, data: { status: "PENDING", error: (message || "Taken").slice(0, 500) } })
    return NextResponse.json({ error: message, code, freeSlots, proposal: proposalView(reopened) }, { status: 409 })
  }

  const card = ok ? cardFromResult(proposal.action, data) : null
  const updated = await prisma.gideonProposal.update({
    where: { id },
    data: ok
      ? { status: "APPLIED", decidedAt: new Date(), result: { card, ...(["book_room", "move_room_booking", "cancel_room_booking"].includes(proposal.action) ? { booking: (data as { booking?: unknown } | null)?.booking ?? null } : {}), ...(proposal.action === "delete_task" ? { auditLogId: (data as { auditLogId?: unknown } | null)?.auditLogId ?? null } : {}) } as object, error: null }
      : { status: "FAILED", decidedAt: new Date(), error: (message || "Failed").slice(0, 500) },
  })
  // An approved AI Autofill value keeps its ✨ marker (CustomFieldAiFill) like one written directly.
  const aiFill = (proposal.input as { aiFill?: Array<{ fieldId?: unknown; value?: unknown }>; taskId?: unknown } | null)
  if (ok && Array.isArray(aiFill?.aiFill) && typeof aiFill?.taskId === "string") {
    for (const f of aiFill.aiFill) if (typeof f.fieldId === "string" && typeof f.value === "string") await markAiFill(f.fieldId, aiFill.taskId, f.value, proposal.runId)
  }
  // No separate audit row: the action itself writes its ActivityLog (GIDEON_TASK_CREATED / _UPDATED /
  // GIDEON_COMMENT_ADDED) exactly as when GIDEON writes without asking.
  return NextResponse.json({ proposal: proposalView(updated) }, { status: ok ? 200 : 422 })
}
