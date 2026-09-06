// Attendance correction via ticket — shared constants, guardrails and serializer.
//
// A correction is a PROPOSAL attached to an ATTENDANCE Complaint. GIDEON (or anyone else) may write
// one; nothing about attendance changes until a BoD approves it at POST /api/complaints/[id]/correction.
// Keeping the propose side and the approve side on the same helpers is what makes that split
// enforceable — the write path is one file, and it is the only one that touches AttendanceRecord.
import { ATTENDANCE_TIMEZONE, attendanceWallClockToUtc, formatAttendanceDateKey } from "@/lib/attendance"

export const CORRECTION_REASON_MIN = 10
export const CORRECTION_REASON_MAX = 1000
export const CORRECTION_NOTE_MAX = 1000

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

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
