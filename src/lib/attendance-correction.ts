import prisma from "@/lib/prisma"
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
 * DAY_OFF is absent deliberately and permanently. Giving a deducted day-off allowance back is not an
 * attendance write, and GIDEON must never touch what the person themselves cannot change; that needs
 * its own propose->approve flow, which does not exist yet.
 */
export const CORRECTABLE_COMPLAINT_CATEGORIES: readonly string[] = ['ATTENDANCE', 'EXP']

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
  createdAt: Date
}

export function serializeAttendanceCorrection(c: CorrectionRow) {
  return {
    id: c.id,
    complaintId: c.complaintId,
    status: c.status,
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
    decidedBy: c.decidedBy,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    decisionNote: c.decisionNote,
    createdAt: c.createdAt.toISOString(),
    canApprove: c.status === "PENDING",
  }
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
 * propose_attendance_correction — the ONLY thing GIDEON may do about attendance.
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
  if (!CORRECTABLE_COMPLAINT_CATEGORIES.includes(complaint.category)) {
    throw new Error(`Ticket ${complaintId} is category ${complaint.category}; an attendance correction only attaches to an ATTENDANCE or EXP ticket.`)
  }
  if (complaint.status === 'CLOSED') throw new Error('Tiket ini udah ditutup, gak bisa diusulin koreksi lagi.')

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

  // One live proposal per ticket (the DB carries a partial unique index saying the same). Two PENDING
  // rows means the BoD approves whichever the UI happened to show and the other stays live forever.
  const existingPending = await prisma.attendanceCorrection.findFirst({
    where: { complaintId, status: 'PENDING' },
    select: { id: true },
  })
  if (existingPending) {
    throw new Error(`Tiket ini udah punya usulan koreksi yang nunggu approval BoD (${existingPending.id}).`)
  }

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

  const created = await prisma.$transaction(async (tx) => {
    const correction = await tx.attendanceCorrection.create({
      data: {
        complaintId,
        workspaceId: complaint.workspaceId,
        userId: complaint.reporterId,
        attendanceDate,
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
      },
      include: ATTENDANCE_CORRECTION_INCLUDE,
    })
    // Put it in the thread too. A proposal only the API can see is a proposal nobody approves.
    await tx.complaintMessage.create({
      data: {
        complaintId,
        authorId: authorId,
        fromReviewer: actorIsBod,
        body: `Usulan koreksi absen — ${summary}. Alasan: ${reason}\n\nAbsennya BELUM berubah; nunggu approve BoD.`.slice(0, THREAD_BODY_MAX),
      },
    })
    await tx.complaint.update({ where: { id: complaintId }, data: { lastMessageAt: new Date() } })
    await tx.complaintEvent.create({
      data: { complaintId, action: 'correction_proposed', actorId: authorId },
    })
    // A live proposal IS a decision waiting on a BoD, whoever wrote it, so an untouched ticket says
    // so on the list instead of looking like one nobody has read. Only ever out of OPEN: a ticket a
    // director already took on stays IN_REVIEW, and the list marker carries the proposal there.
    // The status is guarded in the WHERE, not by the read further up — minutes can pass between
    // GIDEON reading the ticket and filing this.
    const bumped = await tx.complaint.updateMany({
      where: { id: complaintId, status: 'OPEN' },
      data: { status: 'AWAITING_DECISION' },
    })
    if (bumped.count > 0) {
      await tx.complaintEvent.create({
        data: { complaintId, action: 'status', fromStatus: 'OPEN', toStatus: 'AWAITING_DECISION', actorId: authorId },
      })
    }
    return correction
  })

  return {
    ...serializeAttendanceCorrection(created),
    // Spelled out because GIDEON relays this to a person, and "done" would be a lie.
    applied: false,
    note: 'Recorded as a PROPOSAL on the ticket. Attendance is unchanged until a BoD approves it.',
  }
}
