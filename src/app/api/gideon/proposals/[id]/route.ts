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
import { taskTargetOptions } from "@/lib/gideon-task-target"
import type { Prisma } from "@/generated/prisma"
import { isExtraAction } from "@/lib/gideon-tools/meta"
import { extraTool } from "@/lib/gideon-tools"
import type { WebCall, WebCaller, WebReply } from "@/lib/gideon-tools/types"

const CREATE_TASK_LATEST_APP = "Open on the latest app or the web to choose the project for this task · Buka di app terbaru atau web untuk memilih project task ini"
const NOT_EDITABLE = "You can't add tasks to that project (it needs Can edit, and an open task project). Pick another · Kamu tidak bisa menambah task di project itu (butuh akses Can edit di project task yang aktif). Pilih project lain"
const EXTRA_LATEST_APP = "Open on the latest app or the web to do this · Buka di app terbaru atau web untuk melakukan ini"
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
  const body = (await req.json().catch(() => ({}))) as { decision?: string; booking?: unknown; confirm?: unknown; task?: unknown }
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

  // create_task with the project picker (owner, 18 Oct 2026): Apply carries what the card chose —
  // `task: { projectId, taskListId?, assigneeIds?, dueDate? }`. Without it (a released app drawing plain rows) the
  // answer is "open on the latest app or the web" and the proposal keeps waiting: a task never lands in a project
  // nobody picked. The project is checked again now (Can edit, open, a task project → else 403, card stays open),
  // the section must be that project's, the PIC its members.
  if (proposal.action === "create_task" && (proposal.input as { pickProject?: unknown } | null)?.pickProject === true) {
    const stored = (proposal.input as Record<string, unknown>) ?? {}
    const t = body.task && typeof body.task === "object" ? (body.task as Record<string, unknown>) : null
    const projectId = typeof t?.projectId === "string" && t.projectId ? t.projectId : null
    if (!projectId) {
      const view = { ...proposalView(proposal), status: "FAILED", error: CREATE_TASK_LATEST_APP }
      return NextResponse.json({ error: CREATE_TASK_LATEST_APP, code: "NEEDS_LATEST_APP", proposal: view }, { status: 409 })
    }
    const options = await taskTargetOptions(session.user.id, projectId)
    if (!options) {
      const view = { ...proposalView(proposal), error: NOT_EDITABLE }
      return NextResponse.json({ error: NOT_EDITABLE, code: "NEEDS_EDIT_ACCESS", proposal: view }, { status: 403 })
    }
    const taskListId = typeof t?.taskListId === "string" && t.taskListId ? t.taskListId : null
    const section = taskListId ? options.sections.find((x) => x.id === taskListId) : null
    if (taskListId && !section) return NextResponse.json({ error: "That column is not in this project · Kolom itu bukan milik project ini", code: "BAD_SECTION", proposal: proposalView(proposal) }, { status: 400 })
    const assigneeIds = Array.isArray(t?.assigneeIds) ? Array.from(new Set((t.assigneeIds as unknown[]).filter((x): x is string => typeof x === "string"))) : []
    const memberIds = new Set(options.members.map((m) => m.id))
    if (assigneeIds.some((a) => !memberIds.has(a))) return NextResponse.json({ error: "A PIC is not a member of this project · Ada PIC yang bukan anggota project ini", code: "BAD_ASSIGNEE", proposal: proposalView(proposal) }, { status: 400 })
    const dueRaw = t?.dueDate
    const dueDate = dueRaw === null || dueRaw === "" ? null : typeof dueRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : undefined
    const target = (stored.taskTarget as Record<string, unknown> | undefined) ?? {}
    const project = ((target.projects as Array<{ id: string; name: string }> | undefined) ?? []).find((p) => p.id === projectId)
    const input: Record<string, unknown> = {
      ...stored,
      projectId,
      ...(section ? { taskListId: section.id, ...(section.taskStatus ? { status: section.taskStatus } : {}) } : {}),
      assigneeIds,
      ...(dueDate !== undefined ? { dueDate, taskTarget: { ...target, dueDay: dueDate } } : {}),
    }
    if (!section) delete input.taskListId
    const title = typeof stored.title === "string" ? stored.title : ""
    await prisma.gideonProposal.updateMany({
      where: { id, status: "PENDING" },
      data: { input: input as Prisma.InputJsonValue, projectId, summary: `Create task “${title}”${project ? ` in ${project.name}` : ""}`.slice(0, 300) },
    })
  }

  // The 18 Oct 2026 package (inbox/chat/reminders/leave/…, lib/gideon-tools/meta.ts): only its own card applies it,
  // and that card sends the proposal id back (`confirm: { proposalId }`). A released app draws these as plain rows
  // and sends no confirm: it is told to open the latest app or the web, and the proposal stays waiting.
  if (isExtraAction(proposal.action)) {
    const confirm = body.confirm && typeof body.confirm === "object" ? (body.confirm as Record<string, unknown>) : null
    if (confirm?.proposalId !== id) {
      const view = { ...proposalView(proposal), status: "FAILED", error: EXTRA_LATEST_APP }
      return NextResponse.json({ error: EXTRA_LATEST_APP, code: "NEEDS_LATEST_APP", proposal: view }, { status: 409 })
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

  // A write of the package that runs through the person's OWN session: the endpoint the app itself calls, with the
  // cookie (or bearer) of this request — every rule, permission, lock, realtime event and notification of that
  // endpoint applies, and nothing is reimplemented. The calls are built from the stored proposal only.
  const extraWeb = extraTool(proposal.action)?.web
  if (extraWeb) {
    const call: WebCaller = (c) => callAsPerson(req, c)
    let outcome: { ok: boolean; message?: string | null; link?: string | null; result?: Record<string, unknown> }
    try {
      outcome = await extraWeb((proposal.input as Record<string, unknown>) ?? {}, call)
    } catch (error) {
      outcome = { ok: false, message: error instanceof Error ? error.message : "Failed" }
    }
    const updated = await prisma.gideonProposal.update({
      where: { id },
      data: outcome.ok
        ? { status: "APPLIED", decidedAt: new Date(), result: { card: null, link: outcome.link ?? null, note: outcome.message ?? null, ...(outcome.result ?? {}) } as object, error: null }
        : { status: "FAILED", decidedAt: new Date(), error: (outcome.message || "Failed").slice(0, 500) },
    })
    return NextResponse.json({ proposal: proposalView(updated) }, { status: outcome.ok ? 200 : 422 })
  }

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
  const extraLink = ok && isExtraAction(proposal.action) && typeof (data as { link?: unknown } | null)?.link === "string" ? (data as { link: string }).link : null
  const updated = await prisma.gideonProposal.update({
    where: { id },
    data: ok
      ? { status: "APPLIED", decidedAt: new Date(), result: { card, ...(extraLink ? { link: extraLink } : {}), ...(["book_room", "move_room_booking", "cancel_room_booking"].includes(proposal.action) ? { booking: (data as { booking?: unknown } | null)?.booking ?? null } : {}), ...(proposal.action === "delete_task" ? { auditLogId: (data as { auditLogId?: unknown } | null)?.auditLogId ?? null } : {}) } as object, error: null }
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

/**
 * One request to a NEXUS endpoint AS the person deciding this card: their own cookie / bearer, so the endpoint sees
 * exactly the request the app would send. Local only (127.0.0.1), /api/ paths only, never a path from the body.
 * `X-Nexus-Client: web/1`: the card is a current client, so the endpoint holds it to the current rules (the strict
 * side of every client-version gate, e.g. one date per attendance request).
 */
async function callAsPerson(req: NextRequest, c: WebCall): Promise<WebReply> {
  if (!/^\/api\/[A-Za-z0-9/_\-?=&.%:]+$/.test(c.path) || c.path.includes("..")) throw new Error("Bad internal path")
  const headers: Record<string, string> = { "x-nexus-client": "web/1", "x-forwarded-proto": "https", accept: "application/json" }
  const cookie = req.headers.get("cookie")
  if (cookie) headers.cookie = cookie
  const authorization = req.headers.get("authorization")
  if (authorization) headers.authorization = authorization
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  if (host) headers["x-forwarded-host"] = host
  let body: BodyInit | undefined
  if (c.form || c.files) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(c.form ?? {})) fd.set(k, v)
    for (const [k, f] of Object.entries(c.files ?? {})) fd.set(k, new Blob([new Uint8Array(Buffer.from(f.base64, "base64"))], { type: f.type }), f.name)
    body = fd
  } else if (c.json !== undefined) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(c.json)
  }
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}${c.path}`, { method: c.method, headers, body, signal: AbortSignal.timeout(30_000) })
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return { status: res.status, ok: res.ok, body: json }
}
