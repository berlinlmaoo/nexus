import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { getGideonUserId } from "@/lib/gideon-identity"
import { isBodPlus } from "@/lib/feed"

/** Trimmed, or undefined when there is nothing there. Tool input arrives untyped. */
function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Thread message cap, spelled here rather than imported from lib/complaints.
 *
 * complaints.ts already imports this file for the correction include, so importing back would close
 * a cycle — and a cycle between two modules that each define constants the other reads at load time
 * is the kind that works until the day module order changes.
 */
const THREAD_BODY_MAX = 4000

// Attendance correction via ticket — shared constants, guardrails and serializer.
//
// A correction is a PROPOSAL attached to an ATTENDANCE or EXP Complaint. GIDEON (or anyone else) may
// write one; nothing about attendance changes until a BoD approves it at POST /api/complaints/[id]/correction.
// Keeping the propose side and the approve side on the same helpers is what makes that split
// enforceable — the write path is one file, and it is the only one that touches AttendanceRecord.
import { ATTENDANCE_TIMEZONE, attendanceWallClockToUtc, formatAttendanceDateKey, parseDateOnlyToUtc } from "@/lib/attendance"
import { findCoveringAttendanceRequests, isAutoDeduction, isOutageDay, readAttendancePenaltiesForDate } from "@/lib/attendance-absence"

/**
 * The two remedies a ticket can ask for. See the AttendanceCorrectionKind enum in schema.prisma for
 * why they share one model: one live proposal per ticket, one card, one decide route.
 *
 * A ticket whose day is covered by a leave/permit/sick request, or that fell on a day NEXUS was down,
 * does not have wrong TIMES — it has a penalty it should never have been charged. Before this existed
 * the only tool was "propose a time", so every such case was shaped into a time: the reporter got back
 * a proposal restating the clock he was complaining about, or one moving him from one late arrival to
 * a slightly earlier one. Neither undoes the deduction he actually filed about.
 */
export const ATTENDANCE_CORRECTION_KINDS = ["TIME_CORRECTION", "PENALTY_CANCELLATION"] as const
export type AttendanceCorrectionKind = (typeof ATTENDANCE_CORRECTION_KINDS)[number]

export const CORRECTION_REASON_MIN = 10
export const CORRECTION_REASON_MAX = 1000
export const CORRECTION_NOTE_MAX = 1000

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The ticket categories an attendance correction may attach to.
 *
 * EXP is here because an EXP ticket is nearly always an attendance ticket wearing a different label:
 * the reporter noticed the XP deduction, but the deduction is downstream of a wrong AttendanceRecord,
 * so fixing the record IS the fix and the refund rides along with the approval.
 *
 * DAY_OFF sits in this list for ONE shape of correction only: recording a day that has NO record at
 * all (the person was on duty — shooting, an event — and the day still reads as absent after the
 * penalties were refunded). Moving the times of an existing record is refused on a DAY_OFF ticket in
 * proposeAttendanceCorrection below; that never restores an allowance. A PENALTY CANCELLATION always does — the day-off allowance that people complain about losing is, in
 * every case seen so far, the nightly cron's AUTO deduction (alpha / late >120), and approving a
 * cancellation already restores that allowance together with the XP (`autoDayOffs`). Keeping DAY_OFF
 * locked out of that remedy meant Violet's ticket (13 Sep 2026: permit cancelled, sick, one day-off
 * cut) got an answer and no proposal — the exact "solved but nothing happened" the BoD complained
 * about. So `openProposal` takes `allowDayOff`, set only by the cancellation remedy. GIDEON still
 * cannot touch a day off the person CHOSE: a cancellation with nothing auto-deducted is refused below.
 */
export const CORRECTABLE_COMPLAINT_CATEGORIES: readonly string[] = ['ATTENDANCE', 'EXP', 'DAY_OFF']
const CANCELLATION_COMPLAINT_CATEGORIES: readonly string[] = ['ATTENDANCE', 'EXP', 'DAY_OFF']

// A check-out further than this from its check-in is a typo, not a shift. Night shifts still fit.
const MAX_SHIFT_MS = 24 * 60 * 60 * 1000

export type CorrectionDecision = "APPROVE" | "REJECT"

/**
 * Parse one proposed time. Accepts "HH:mm" (what a chat actually yields — read as office-local on the
 * attendance date) or a full ISO-8601 timestamp. Returns undefined for "not proposed", which is
 * different from a bad value: that throws, because silently dropping an unparseable time would let an
 * approval write a half-correction nobody asked for.
 */
export function parseProposedTime(value: unknown, dateKey: string, label: string): Date | undefined {
  if (value === undefined || value === null) return undefined
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return undefined

  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const at = attendanceWallClockToUtc(dateKey, raw)
    if (!at) throw new Error(`Invalid ${label}: "${raw}"`)
    return at
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}: "${raw}" — use "HH:mm" (${ATTENDANCE_TIMEZONE}) or a full ISO-8601 timestamp`)
  }
  return parsed
}

/**
 * Guardrails applied at BOTH ends — when the proposal is filed and again against the merged values at
 * approval, since the record may hold the half the proposal left alone. Returns a message to show the
 * caller, or null when the pair is sane.
 */
export function validateCorrectionTimes(
  dateKey: string,
  checkInAt: Date | null,
  checkOutAt: Date | null
): string | null {
  if (checkInAt && formatAttendanceDateKey(checkInAt) !== dateKey) {
    return `Jam masuk yang diusulkan jatuh di tanggal ${formatAttendanceDateKey(checkInAt)}, bukan ${dateKey}.`
  }
  if (checkInAt && checkOutAt) {
    if (checkOutAt.getTime() < checkInAt.getTime()) return "Jam pulang gak boleh lebih awal dari jam masuk."
    if (checkOutAt.getTime() - checkInAt.getTime() > MAX_SHIFT_MS) {
      return "Selisih masuk–pulang lebih dari 24 jam. Cek lagi tanggal/jamnya."
    }
  }
  return null
}

/** Everything the ticket UI needs to render a proposal. */
export const ATTENDANCE_CORRECTION_INCLUDE = {
  user: { select: { id: true, name: true, avatar: true } },
  proposedBy: { select: { id: true, name: true, avatar: true } },
  decidedBy: { select: { id: true, name: true, avatar: true } },
}

export type AttendanceCorrectionRow = CorrectionRow

type CorrectionPerson = { id: string; name: string; avatar?: string | null }
type CorrectionRow = {
  id: string
  complaintId: string
  userId: string
  user: CorrectionPerson
  attendanceDate: Date
  kind: string
  proposedCheckInAt: Date | null
  proposedCheckOutAt: Date | null
  reason: string
  proposedById: string
  proposedBy: CorrectionPerson
  status: string
  decidedById: string | null
  decidedBy: CorrectionPerson | null
  decidedAt: Date | null
  decisionNote: string | null
  beforeRecordId: string | null
  beforeCheckInAt: Date | null
  beforeCheckOutAt: Date | null
  beforeStatus: string | null
  beforePenaltyXp: number | null
  beforeAutoDayOffs: number | null
  restoredDayOffs: number | null
  refundedXp: number | null
  waiverGranted: boolean
  createdAt: Date
}

export function serializeAttendanceCorrection(c: CorrectionRow) {
  return {
    id: c.id,
    complaintId: c.complaintId,
    status: c.status,
    // Which remedy is being asked for. The card branches on this: a TIME_CORRECTION draws a
    // before/after clock, a PENALTY_CANCELLATION says the clock is staying exactly as it is.
    kind: c.kind,
    // Date-key rather than the raw 00:00 UTC Date — every attendance screen already speaks in keys,
    // and a client re-formatting the Date in its own zone would show the previous day.
    date: formatAttendanceDateKey(c.attendanceDate),
    user: c.user,
    proposedCheckInAt: c.proposedCheckInAt?.toISOString() ?? null,
    proposedCheckOutAt: c.proposedCheckOutAt?.toISOString() ?? null,
    reason: c.reason,
    proposedBy: c.proposedBy,
    // What the record held when this was proposed — the values an approval can be undone back to.
    before: {
      recordId: c.beforeRecordId,
      checkInAt: c.beforeCheckInAt?.toISOString() ?? null,
      checkOutAt: c.beforeCheckOutAt?.toISOString() ?? null,
      status: c.beforeStatus,
    },
    // What the day had cost when this was written (negative), and — once decided — what came back and
    // whether the pardon was made permanent. The ledger rows are DELETED by the refund, so if these
    // are not kept here nobody can answer "what did approving this actually do" afterwards.
    beforePenaltyXp: c.beforePenaltyXp,
    // Potongan absen tidak selalu berupa XP saja: hari tanpa check-in juga memakan satu jatah
    // day-off, dan approve mengembalikan keduanya. Kartu yang hanya menyebut XP membuat approve
    // terlihat lebih kecil dari kenyataannya.
    beforeAutoDayOffs: c.beforeAutoDayOffs,
    restoredDayOffs: c.restoredDayOffs,
    refundedXp: c.refundedXp,
    waiverGranted: c.waiverGranted,
    decidedBy: c.decidedBy,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    decisionNote: c.decisionNote,
    createdAt: c.createdAt.toISOString(),
    canApprove: c.status === "PENDING",
  }
}

/**
 * Does pardoning this day need a WAIVER to stick, or would one be a lie?
 *
 * A refund on its own does not hold. The nightly job re-derives penalties across a rolling window and
 * would simply re-cut the same XP tomorrow. `grantAttendanceWaiver` is the marker that stops it — but
 * it is PERMANENT and STATUS-BLIND: once written, that member-day can never be penalised again, no
 * matter what is later decided about it. So it is exactly right in one case and wrong in the other:
 *
 *   - A live leave/permit/sick request already covers the day. Both crons honour it (PENDING as much as
 *     APPROVED — see processAbsenceDeductions and accrueLatePenalties), so the refund sticks by itself,
 *     and `cancelAttendancePenaltiesForRange` — the path that runs when such a request is filed — has
 *     never granted a waiver either. More importantly, if a BoD later REJECTS that permit the penalty
 *     is supposed to come back; `rederiveLatePenaltyForDate` exists for precisely that. A waiver here
 *     would make the rejection unenforceable, quietly and forever.
 *   - Nothing covers the day: the pardon rests on the BoD's own judgement (an outage NEXUS never
 *     recorded is the usual one). Nothing else will hold the cron off, so without a waiver the member
 *     watches their points come back and vanish overnight. Here the waiver IS the decision.
 *
 * A date the workspace has registered in ATTENDANCE_OUTAGE_DATES needs no waiver either — both crons
 * skip the whole day. That register is sparsely maintained, so a `false` from it means "not recorded",
 * never "did not happen", and the branch below treats it that way: unrecorded outage → waiver.
 */
export async function resolvePardonPersistence(userId: string, workspaceId: string, date: Date, dateKey: string) {
  const covering = await findCoveringAttendanceRequests(userId, workspaceId, date)
  // The cron's own "Auto:" day-off is a penalty, not cover for one, so it never counts as cover here.
  const realCover = covering.filter((r) => !isAutoDeduction(r))
  const outageRegistered = await isOutageDay(dateKey)
  if (realCover.length > 0) {
    return {
      waiverNeeded: false,
      why: `hari itu ketutup ${realCover.length} pengajuan (${realCover.map((r) => `${r.type}/${r.status}`).join(", ")}) — cron udah nahan potongannya sendiri, dan kalau pengajuannya nanti ditolak potongannya balik lagi (itu memang seharusnya)`,
    }
  }
  if (outageRegistered) {
    return { waiverNeeded: false, why: `${dateKey} udah tercatat sebagai hari NEXUS down, jadi semua cron ngelewatin hari itu` }
  }
  return {
    waiverNeeded: true,
    why: 'gak ada pengajuan yang nutup hari itu dan tanggalnya belum tercatat sebagai hari NEXUS down, jadi tanpa waiver potongannya bakal dipotong ulang sama cron nanti malam',
  }
}

/** "2026-09-04: batalkan potongan 120 XP" — the cancellation's one-line equivalent of describeCorrection. */
export function describePenaltyCancellation(dateKey: string, penaltyXp: number, autoDayOffs = 0) {
  const parts: string[] = []
  if (penaltyXp < 0) parts.push(`batalin potongan ${Math.abs(penaltyXp)} XP`)
  if (autoDayOffs > 0) parts.push(`balikin ${autoDayOffs} jatah day-off yang kepotong otomatis`)
  return `${dateKey}: ${parts.length ? parts.join(" + ") : "batalin potongan absen"}, jam absennya TETAP`
}

/** One-line "08:12 → 09:03" style summary, used for the ticket message and audit metadata. */
export function describeCorrection(input: {
  dateKey: string
  beforeCheckInAt: Date | null
  beforeCheckOutAt: Date | null
  proposedCheckInAt: Date | null
  proposedCheckOutAt: Date | null
}) {
  const hm = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("en-GB", { timeZone: ATTENDANCE_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d)
      : "—"
  const parts: string[] = []
  if (input.proposedCheckInAt) parts.push(`masuk ${hm(input.beforeCheckInAt)} → ${hm(input.proposedCheckInAt)}`)
  if (input.proposedCheckOutAt) parts.push(`pulang ${hm(input.beforeCheckOutAt)} → ${hm(input.proposedCheckOutAt)}`)
  return `${input.dateKey}: ${parts.join(", ")}`
}

/**
 * The thread side of filing a proposal, identical for both remedies: say it in the ticket, mark the
 * ticket as touched, log the event, and lift an untouched ticket into "waiting on a BoD".
 *
 * Shared so a penalty cancellation cannot go quiet where a time correction speaks. A proposal only the
 * API can see is a proposal nobody approves, and that failure would be invisible: the row exists, the
 * tool reports success, and the ticket looks like one nobody has read.
 */
async function attachProposalToThread(
  tx: Prisma.TransactionClient,
  opts: { complaintId: string; authorId: string; actorIsBod: boolean; body: string },
) {
  await tx.complaintMessage.create({
    data: {
      complaintId: opts.complaintId,
      authorId: opts.authorId,
      fromReviewer: opts.actorIsBod,
      body: opts.body.slice(0, THREAD_BODY_MAX),
    },
  })
  await tx.complaint.update({ where: { id: opts.complaintId }, data: { lastMessageAt: new Date() } })
  await tx.complaintEvent.create({
    data: { complaintId: opts.complaintId, action: 'correction_proposed', actorId: opts.authorId },
  })
  // A live proposal IS a decision waiting on a BoD, whoever wrote it, so an untouched ticket says so
  // on the list instead of looking like one nobody has read. Only ever out of OPEN: a ticket a
  // director already took on stays IN_REVIEW, and the list marker carries the proposal there.
  // The status is guarded in the WHERE, not by a read further up — minutes can pass between GIDEON
  // reading the ticket and filing this.
  const bumped = await tx.complaint.updateMany({
    where: { id: opts.complaintId, status: 'OPEN' },
    data: { status: 'AWAITING_DECISION' },
  })
  if (bumped.count > 0) {
    await tx.complaintEvent.create({
      data: { complaintId: opts.complaintId, action: 'status', fromStatus: 'OPEN', toStatus: 'AWAITING_DECISION', actorId: opts.authorId },
    })
  }
}

/**
 * Everything both remedies must clear before anything is written: a real ticket, in the actor's
 * workspace, that the actor may see, in a category corrections attach to, not closed, with a date and
 * a sentence a BoD can decide on.
 *
 * Extracted so the second remedy cannot quietly be laxer than the first. The gate that keeps DAY_OFF
 * out, and the one that stops a staffer filing against a colleague's day, are the same code for both.
 */
async function openProposal(
  actor: { id: string; role?: string | null; name?: string | null },
  input: Record<string, unknown>,
  opts?: { allowDayOff?: boolean },
) {
  const complaintId = asString(input.complaintId)
  const dateKey = asString(input.date) ?? asString(input.attendanceDate)
  const reason = asString(input.reason)

  if (!complaintId) throw new Error('complaintId is required')
  if (!dateKey || !DATE_KEY_RE.test(dateKey)) throw new Error('date is required as "YYYY-MM-DD"')
  if (!reason || reason.length < CORRECTION_REASON_MIN) {
    throw new Error(`reason is required (min ${CORRECTION_REASON_MIN} chars) — the BoD approves on this sentence alone`)
  }

  // Same visibility rule as GET /api/complaints/[id]: the reporter, or a BoD, inside their own
  // workspace. System ADMIN gets no carve-out here on purpose — complaints are private by design and
  // the web never granted admins a way in either.
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: actor.id },
    select: { workspaceId: true, role: true },
  })
  if (!membership) throw new Error('You are not a member of any workspace')
  const actorIsBod = isBodPlus(membership.role)

  const complaint = await prisma.complaint.findUnique({
    where: { id: complaintId },
    select: { id: true, workspaceId: true, reporterId: true, category: true, status: true },
  })
  if (!complaint || complaint.workspaceId !== membership.workspaceId) throw new Error('Complaint not found or not accessible')
  if (!actorIsBod && complaint.reporterId !== actor.id) throw new Error('Complaint not found or not accessible')
  // THE gate that keeps DAY_OFF out. The prompt tells GIDEON not to try; this is what makes trying
  // fail, so a model that calls the tool anyway gets an error back instead of filing a proposal.
  const allowedCategories = opts?.allowDayOff ? CANCELLATION_COMPLAINT_CATEGORIES : CORRECTABLE_COMPLAINT_CATEGORIES
  if (!allowedCategories.includes(complaint.category)) {
    throw new Error(
      opts?.allowDayOff
        ? `Ticket ${complaintId} is category ${complaint.category}; a penalty cancellation only attaches to an ATTENDANCE, EXP, or DAY_OFF ticket.`
        : `Ticket ${complaintId} is category ${complaint.category}; an attendance correction only attaches to an ATTENDANCE or EXP ticket.`,
    )
  }
  if (complaint.status === 'CLOSED') throw new Error('Tiket ini udah ditutup, gak bisa diusulin koreksi lagi.')

  // One live proposal per ticket, of EITHER kind (the DB carries a partial unique index on complaintId
  // WHERE status = 'PENDING' saying the same). This is why the second remedy is a kind and not a second
  // table: two live proposals would mean the BoD approves whichever the UI happened to show, and a
  // ticket could carry "rewrite the times" and "pardon the day" at once — two answers to one question.
  const existingPending = await prisma.attendanceCorrection.findFirst({
    where: { complaintId, status: 'PENDING' },
    select: { id: true, kind: true },
  })
  if (existingPending) {
    throw new Error(`Tiket ini udah punya usulan yang nunggu approval BoD (${existingPending.id}, ${existingPending.kind}).`)
  }

  return { complaintId, dateKey, reason, complaint, actorIsBod, workspaceId: membership.workspaceId }
}

/**
 * propose_attendance_correction — one of the two things GIDEON may do about attendance.
 *
 * Staff file an ATTENDANCE (or EXP) ticket with a photo; a BoD used to read it and go fix the record by hand in
 * another screen. This lets GIDEON draft that fix ONTO the ticket, and stops there: it writes an
 * AttendanceCorrection row and a message in the thread, never an AttendanceRecord. The record only
 * moves when a human taps approve at POST /api/complaints/[id]/correction. There is deliberately no
 * tool action anywhere in this file that writes attendance — an assistant that can quietly rewrite who
 * was late is worth more to an attacker than every other action here combined.
 *
 * Input: { complaintId, date: "YYYY-MM-DD", checkInAt?, checkOutAt?, reason }
 * checkInAt/checkOutAt take "HH:mm" (office-local) or a full ISO-8601 timestamp; at least one is required.
 */
export async function proposeAttendanceCorrection(
  actor: { id: string; role?: string | null; name?: string | null },
  input: Record<string, unknown>,
  /** Whose name the proposal carries. GIDEON when it drafts one; the reporter when they ask for it
   *  themselves — an assistant that declines, or is not there, must not be the only way to be heard. */
  proposedById?: string,
) {
  const { complaintId, dateKey, reason, complaint, actorIsBod } = await openProposal(actor, input)

  const proposedCheckInAt = parseProposedTime(input.checkInAt, dateKey, 'checkInAt') ?? null
  const proposedCheckOutAt = parseProposedTime(input.checkOutAt, dateKey, 'checkOutAt') ?? null
  if (!proposedCheckInAt && !proposedCheckOutAt) {
    throw new Error('Nothing proposed — give checkInAt, checkOutAt, or both.')
  }

  // The target is the ticket's reporter, never an input field. Otherwise any staffer could ask GIDEON
  // to file a correction against a colleague's attendance from their own ticket.
  const attendanceDate = parseDateOnlyToUtc(dateKey)
  const record = await prisma.attendanceRecord.findUnique({
    where: {
      userId_workspaceId_attendanceDate: {
        userId: complaint.reporterId,
        workspaceId: complaint.workspaceId,
        attendanceDate,
      },
    },
    select: { id: true, checkInAt: true, checkOutAt: true, status: true },
  })
  // A missing record used to be refused outright, on the grounds that inventing a bare one erases an
  // alpha with none of the bookkeeping. That reasoning was about creating it SILENTLY — and it turned
  // out to refuse the commonest complaint there is: nine of the first fourteen tickets were "check-in
  // never landed", which is precisely a day with no record.
  //
  // So a missing day is now proposable, and only proposable. The approver sees that no record exists
  // and what would be written, and the same tap that creates it runs the penalty refund and the
  // waiver — the bookkeeping the old comment was protecting. Creating one still requires a check-in
  // time: a record with no arrival is not a record of anything.
  if (!record && !proposedCheckInAt) {
    throw new Error(
      `Gak ada record absen tanggal ${dateKey} buat pelapor tiket ini. Kalau mau diusulkan dibuat, ` +
        'sertakan checkInAt — jam masuk yang kamu baca dari bukti.'
    )
  }

  const timeError = validateCorrectionTimes(
    dateKey,
    proposedCheckInAt ?? record?.checkInAt ?? null,
    proposedCheckOutAt ?? record?.checkOutAt ?? null
  )
  if (timeError) throw new Error(timeError)

  const summary = describeCorrection({
    dateKey,
    beforeCheckInAt: record?.checkInAt ?? null,
    beforeCheckOutAt: record?.checkOutAt ?? null,
    proposedCheckInAt,
    proposedCheckOutAt,
  })
  // GIDEON wrote it, so GIDEON signs it. The actor's permissions got us here; the authorship says who
  // actually typed it, which is the whole point of the separate identity.
  const authorId = proposedById ?? (await getGideonUserId())

  // Di tiket DAY_OFF, koreksi hanya boleh MENCATAT hari yang belum punya catatan. Menggeser jam catatan
  // yang sudah ada tidak mengembalikan jatah apa pun — itu urusan pembatalan potongan.
  if (complaint.category === 'DAY_OFF' && record) {
    throw new Error(
      `Ticket ${complaintId} is a DAY_OFF ticket and ${dateKey} already has an attendance record; a time correction there restores nothing. Propose a penalty cancellation instead.`,
    )
  }
  // Approve koreksi jam juga MEMBALIKKAN potongan hari itu (XP + jatah day-off otomatis) — lihat
  // cancelAttendancePenaltiesForDate di route approve. Disimpan di baris usulan supaya kartunya bisa
  // menyebutnya; tanpa ini BoD melihat "ubah jam" dan mengira jatah day off-nya tidak ikut.
  const penaltiesNow = await readAttendancePenaltiesForDate(complaint.reporterId, complaint.workspaceId, attendanceDate, dateKey)
  const created = await prisma.$transaction(async (tx) => {
    const correction = await tx.attendanceCorrection.create({
      data: {
        complaintId,
        workspaceId: complaint.workspaceId,
        userId: complaint.reporterId,
        attendanceDate,
        // Spelled out rather than left to the column default: the row says which remedy it is, and a
        // reader of this file does not have to go to schema.prisma to find out.
        kind: 'TIME_CORRECTION',
        proposedCheckInAt,
        proposedCheckOutAt,
        reason: reason.slice(0, CORRECTION_REASON_MAX),
        proposedById: authorId,
        status: 'PENDING',
        // All null when the day has no record at all. That absence IS the snapshot, and it is what
        // tells the approve path to create rather than update — and what the card reads to say
        // "belum ada catatan" instead of drawing a comparison against nothing.
        beforeRecordId: record?.id ?? null,
        beforeCheckInAt: record?.checkInAt ?? null,
        beforeCheckOutAt: record?.checkOutAt ?? null,
        beforeStatus: record?.status ?? null,
        beforePenaltyXp: penaltiesNow.lateXp + penaltiesNow.noCheckoutXp + penaltiesNow.alphaXp,
        beforeAutoDayOffs: penaltiesNow.autoDayOffs,
      },
      include: ATTENDANCE_CORRECTION_INCLUDE,
    })
    await attachProposalToThread(tx, {
      complaintId,
      authorId,
      actorIsBod,
      body: `Usulan koreksi absen — ${summary}. Alasan: ${reason}\n\nAbsennya BELUM berubah; nunggu approve BoD.`,
    })
    return correction
  })

  return {
    ...serializeAttendanceCorrection(created),
    // Spelled out because GIDEON relays this to a person, and "done" would be a lie.
    applied: false,
    note: 'Recorded as a PROPOSAL on the ticket. Attendance is unchanged until a BoD approves it.',
  }
}

/**
 * propose_penalty_cancellation — the second remedy, and the one that was missing.
 *
 * Reverses the day's XP penalty and CHANGES NO TIME. It exists because two whole classes of ticket
 * have nothing wrong with their recorded times:
 *
 *   - a leave / permit / sick request covers the day. PENDING counts: the crons already hold the
 *     penalty back for a request that is merely filed, so a day covered by one is not plain lateness
 *     however late the clock says the person arrived.
 *   - NEXUS itself was unreachable, so the person could not check in at all. The arrival time on their
 *     screenshot is when they gave up trying, not when they were due — proposing it as a check-in
 *     simply moves them from one late arrival to another and refunds nothing.
 *
 * Shaped into "propose a time", both of those produced a proposal that either restated the record or
 * left the deduction standing. This proposes the deduction itself.
 *
 * Still a PROPOSAL and nothing else: it writes an AttendanceCorrection row and a thread message. No XP
 * moves until a BoD taps approve at POST /api/complaints/[id]/correction. GIDEON must never apply one,
 * and there is deliberately no path in this file that does.
 *
 * Input: { complaintId, date: "YYYY-MM-DD", reason }. No times — accepting one would reopen the exact
 * mistake this remedy exists to end.
 */
export async function proposeAttendancePenaltyCancellation(
  actor: { id: string; role?: string | null; name?: string | null },
  input: Record<string, unknown>,
  /** Whose name it carries — GIDEON when it drafts one, the reporter when they ask for it themselves. */
  proposedById?: string,
) {
  const { complaintId, dateKey, reason, complaint, actorIsBod } = await openProposal(actor, input, { allowDayOff: true })

  // The target is the ticket's reporter, never an input field — same rule as the time correction, and
  // for the same reason: otherwise any staffer could ask GIDEON to pardon a colleague's day from their
  // own ticket.
  const userId = complaint.reporterId
  const workspaceId = complaint.workspaceId
  const attendanceDate = parseDateOnlyToUtc(dateKey)

  // What the day ACTUALLY cost, read from the ledger by the same function the outage refund uses.
  const penalties = await readAttendancePenaltiesForDate(userId, workspaceId, attendanceDate, dateKey)
  const penaltyXp = penalties.lateXp + penalties.noCheckoutXp + penalties.alphaXp // negative, or 0

  // Nothing to undo is not a proposal, it is a misreading — and the commonest way to get here is a day
  // whose penalty a cron already refunded once the permit was approved. Saying so is more useful than
  // filing a pardon for a day that costs nothing: the reporter's XP is already back.
  if (penaltyXp === 0 && penalties.autoDayOffs === 0) {
    throw new Error(
      `Tanggal ${dateKey} lagi gak punya potongan absen yang bisa dibatalin buat pelapor tiket ini — ` +
        'ledger-nya kosong (mungkin udah dikembalikan). Jangan usulin pembatalan; jelasin aja apa adanya.'
    )
  }

  // The times are snapshotted even though nothing will touch them. The card shows what STAYS, and an
  // approval that changed nothing is only provably harmless if what it left alone was written down.
  const record = await prisma.attendanceRecord.findUnique({
    where: { userId_workspaceId_attendanceDate: { userId, workspaceId, attendanceDate } },
    select: { id: true, checkInAt: true, checkOutAt: true, status: true },
  })

  const summary = describePenaltyCancellation(dateKey, penaltyXp, penalties.autoDayOffs)
  // GIDEON wrote it, so GIDEON signs it. The actor's permissions got us here; the authorship says who
  // actually typed it.
  const authorId = proposedById ?? (await getGideonUserId())

  const created = await prisma.$transaction(async (tx) => {
    const correction = await tx.attendanceCorrection.create({
      data: {
        complaintId,
        workspaceId,
        userId,
        attendanceDate,
        kind: 'PENALTY_CANCELLATION',
        // Both null, and that is the whole difference. The approve path reads the kind, not these.
        proposedCheckInAt: null,
        proposedCheckOutAt: null,
        reason: reason.slice(0, CORRECTION_REASON_MAX),
        proposedById: authorId,
        status: 'PENDING',
        beforeRecordId: record?.id ?? null,
        beforeCheckInAt: record?.checkInAt ?? null,
        beforeCheckOutAt: record?.checkOutAt ?? null,
        beforeStatus: record?.status ?? null,
        beforePenaltyXp: penaltyXp,
        beforeAutoDayOffs: penalties.autoDayOffs,
      },
      include: ATTENDANCE_CORRECTION_INCLUDE,
    })
    await attachProposalToThread(tx, {
      complaintId,
      authorId,
      actorIsBod,
      body: `Usulan pembatalan potongan absen — ${summary}. Alasan: ${reason}\n\nXP-nya BELUM balik dan jam absennya gak diubah; nunggu approve BoD.`,
    })
    return correction
  })

  return {
    ...serializeAttendanceCorrection(created),
    applied: false,
    note: 'Recorded as a PROPOSAL on the ticket. No XP has moved and no attendance time was changed; a BoD decides.',
  }
}

