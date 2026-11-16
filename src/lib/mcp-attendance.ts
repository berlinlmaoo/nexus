import crypto from "crypto"
import { NextRequest } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import {
  ATTENDANCE_TIMEZONE,
  attendancePeriodKey,
  attendancePeriodRange,
  deriveAttendanceStatus,
  getAttendanceDate,
  getAttendanceWorkspaceContext,
  parseDateOnlyToUtc,
} from "@/lib/attendance"
import { canUserReviewRequest } from "@/lib/attendance-approvers"
import { classifyAttendanceDays } from "@/lib/attendance-days"
import { isAutoDeduction, readAttendancePenaltiesForDate } from "@/lib/attendance-absence"
import { DATE_KEY_RE, parseProposedTime, validateCorrectionTimes } from "@/lib/attendance-correction"
import { recordLevel, recordSides } from "@/lib/attendance-suspect"
import { applyAttendanceOverride, resolveOverridePresentTimes, type OverrideBody } from "@/lib/attendance-override"
import { applyAttendanceRecordCorrection, planAttendanceRecordCorrection } from "@/lib/attendance-record-correction"
import { emitAttendanceChanged } from "@/lib/socket-emitter"
import { hashToken, type McpCaller } from "@/lib/mcp-token-auth"
import { publicUrl } from "@/lib/public-url"
import { readDeductionLog } from "@/lib/attendance-deduction-log"

/**
 * Attendance over MCP (owner, 17 Nov 2026: a connected assistant acting as its owner).
 *
 * READ  (scope attendance:read): the people the caller may approve in the Bagan Approval
 *        (lib/attendance-approvers.ts canUserReviewRequest — the one resolver), plus the caller themself.
 *        A Staff member sees only themself. "Staff Management" read-only viewers are NOT widened here.
 * WRITE (scope attendance:write): a correction of one person-day, approved by a human on the NEXUS web:
 *   1. preview (MCP) → validates everything the write would, computes the exact before/after with the same functions
 *      the write uses, and stores the change server-side. Nothing is written. It returns an approval link
 *      (/approve/mcp/<secret>: unguessable, 10 minutes, single use) and a requestId.
 *   2. decision (WEB, owner 17 Nov 2026) → the assistant sends the link to the person; the page needs a normal NEXUS
 *      web session (cookie, never a bearer/MCP token) of the SAME person who owns the connection. Approve runs the
 *      stored change (never anything sent with the decision) through the web's own code: POST /api/attendance/override
 *      (lib/attendance-override.ts) for a missing day marked present, PATCH /api/attendance/records/[id]
 *      (lib/attendance-record-correction.ts) for a time fix — every check made again at that moment. XP refunds,
 *      day-off quota, waivers, outage rules, cancelled single-day requests, notifications, realtime and the audit row
 *      are exactly what the web does; the audit row is the person's, with `via: "<connection name> (MCP)"`.
 *      No MCP tool can approve: the assistant can only read the outcome (get_attendance_correction_status). Codes by
 *      push / email / WhatsApp would not do: the assistant can read the person's WhatsApp and email.
 * On top of the web's rules (deliberately stricter for an AI): the target must be in the caller's approval chain
 * (the web lets any BoD correct anyone), a reason is required, the times must fall on that day, a day with proof
 * of a fake location (or ruled invalid for it) is refused, and "mark present" only fills a day with no record.
 * Corrections themselves still need the web's right to correct (BoD / One Above All): a Manager can read their
 * reports through MCP but not correct them, exactly as on the web.
 */

export const CONFIRMATION_TTL_MS = 10 * 60 * 1000
export const MAX_RANGE_DAYS = 62
const REASON_MIN = 10
const REASON_MAX = 500

export class McpAttendanceError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}
const fail = (code: string, message: string): never => {
  throw new McpAttendanceError(code, message)
}

/** "HH:mm" in the attendance timezone (WIB), or null. */
export function wallClock(at: Date | null | undefined): string | null {
  if (!at) return null
  return new Intl.DateTimeFormat("en-GB", { timeZone: ATTENDANCE_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(at)
}

type Ctx = Awaited<ReturnType<typeof getAttendanceWorkspaceContext>>

export type AudiencePerson = {
  id: string
  name: string | null
  email: string | null
  role: string
  relation: "self" | "direct report" | "approval tree" | "workspace"
  /** May the caller correct this person's attendance (web right + approval chain)? */
  canCorrect: boolean
}

/**
 * Who the caller may see (themself + everyone canUserReviewRequest allows) and correct. The candidates come from
 * the context's approval scope (null = everyone: One Above All); the verdict for each is the shared resolver's.
 */
export async function attendanceAudience(viewerId: string): Promise<{ ctx: Ctx; workspaceId: string | null; people: AudiencePerson[] }> {
  const ctx = await getAttendanceWorkspaceContext(viewerId)
  const workspaceId = ctx.workspace?.id ?? null
  if (!workspaceId) return { ctx, workspaceId: null, people: [] }
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true, role: true, approverId: true, user: { select: { name: true, email: true } } },
  })
  const scope = ctx.approvalScopeUserIds
  const candidateIds = new Set(scope === null ? members.map((m) => m.userId) : [...scope, ...ctx.directReportIds])
  candidateIds.add(viewerId)
  const verdicts = await Promise.all(
    [...candidateIds].map(async (id) => [id, await canUserReviewRequest(viewerId, id, workspaceId, ctx)] as const),
  )
  const reviewable = new Map(verdicts.filter(([, v]) => v.ok).map(([id, v]) => [id, v]))
  const people: AudiencePerson[] = []
  for (const m of members) {
    const isSelf = m.userId === viewerId
    const verdict = reviewable.get(m.userId)
    if (!isSelf && !verdict) continue
    people.push({
      id: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      relation: isSelf ? "self" : m.approverId === viewerId ? "direct report" : scope === null ? "workspace" : "approval tree",
      canCorrect: Boolean(verdict) && ctx.canManageAttendance,
    })
  }
  people.sort((a, b) => (a.relation === "self" ? -1 : b.relation === "self" ? 1 : (a.name ?? "").localeCompare(b.name ?? "")))
  return { ctx, workspaceId, people }
}

/**
 * The write gate, before anything else is read: the web's right to correct (BoD / One Above All —
 * getAttendanceWorkspaceContext.canManageAttendance, what both routes check) AND the target in the caller's
 * approval chain (canUserReviewRequest: four-eyes, One Above All's own days excepted). A current member only.
 */
export async function assertMayCorrect(viewerId: string, targetUserId: string, ctx: Ctx): Promise<string> {
  const workspaceId = ctx.workspace?.id
  if (!workspaceId) return fail("NO_WORKSPACE", "You are not in a workspace.")
  if (!ctx.canManageAttendance) {
    return fail("FORBIDDEN", "Only BoD and One Above All can correct attendance in NEXUS (same rule as the web). You can still read your reports' attendance.")
  }
  const member = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: targetUserId, workspaceId } }, select: { userId: true } })
  if (!member) return fail("NOT_A_MEMBER", "That person is not a current member of your workspace. Correct a former member's days on the web.")
  const verdict = await canUserReviewRequest(viewerId, targetUserId, workspaceId, ctx)
  if (!verdict.ok) {
    return fail(
      viewerId === targetUserId ? "SELF" : "OUTSIDE_APPROVAL_CHAIN",
      viewerId === targetUserId
        ? "You cannot correct your own attendance (four-eyes)."
        : "That person is outside your approval chain (Bagan Approval), so you cannot see or correct their attendance.",
    )
  }
  return workspaceId
}

function parseDateKey(value: unknown, label: string): string {
  const key = typeof value === "string" ? value.trim() : ""
  if (!DATE_KEY_RE.test(key) || Number.isNaN(parseDateOnlyToUtc(key).getTime())) fail("BAD_DATE", `${label} must be a date as YYYY-MM-DD.`)
  return key
}

// ─── Reads ─────────────────────────────────────────────────────────────────────────────────────────────

export async function listAttendancePeople(caller: McpCaller) {
  const { people } = await attendanceAudience(caller.userId)
  return { people }
}

/** Each visible person's days in [from, to] (≤ 62 days), classified as the attendance board does, with times. */
export async function listAttendanceDays(caller: McpCaller, args: { userId?: string; from: string; to?: string }) {
  const fromKey = parseDateKey(args.from, "from")
  const toKey = parseDateKey(args.to ?? args.from, "to")
  const start = parseDateOnlyToUtc(fromKey)
  const end = parseDateOnlyToUtc(toKey)
  if (end < start) fail("BAD_RANGE", "`to` is before `from`.")
  if ((end.getTime() - start.getTime()) / 86_400_000 + 1 > MAX_RANGE_DAYS) fail("BAD_RANGE", `At most ${MAX_RANGE_DAYS} days per call.`)
  const { workspaceId, people } = await attendanceAudience(caller.userId)
  if (!workspaceId) return { people: [] }
  const visible = new Map(people.map((p) => [p.id, p]))
  if (args.userId && !visible.has(args.userId)) fail("OUTSIDE_APPROVAL_CHAIN", "That person is outside your approval chain (Bagan Approval).")
  const userIds = args.userId ? [args.userId] : [...visible.keys()]
  const [classified, records] = await Promise.all([
    classifyAttendanceDays({ workspaceId, userIds, start, end }),
    prisma.attendanceRecord.findMany({
      where: { workspaceId, userId: { in: userIds }, attendanceDate: { gte: start, lte: end } },
      select: {
        id: true, userId: true, attendanceDate: true, checkInAt: true, checkOutAt: true, status: true, checkInStatus: true, checkOutStatus: true,
        lateMinutes: true, earlyLeaveMinutes: true, workedMinutes: true, correctedAt: true, correctionReason: true, checkInSuspect: true, checkOutSuspect: true,
        checkInSimulated: true, checkOutSimulated: true, correctedBy: { select: { name: true } },
      },
    }),
  ])
  const byDay = new Map(records.map((r) => [`${r.userId}:${r.attendanceDate.toISOString().slice(0, 10)}`, r]))
  return {
    timezone: ATTENDANCE_TIMEZONE,
    people: userIds.map((id) => {
      const p = visible.get(id)!
      return {
        id, name: p.name, relation: p.relation, canCorrect: p.canCorrect,
        days: (classified.get(id) ?? []).map((d) => {
          const r = byDay.get(`${id}:${d.dateKey}`)
          return {
            date: d.dateKey,
            dayType: d.dayType,
            source: d.source,
            requestType: d.requestType,
            ...(r
              ? {
                  recordId: r.id,
                  checkIn: wallClock(r.checkInAt),
                  checkOut: wallClock(r.checkOutAt),
                  checkInStatus: r.checkInStatus,
                  lateMinutes: r.lateMinutes,
                  earlyLeaveMinutes: r.earlyLeaveMinutes,
                  workedMinutes: r.workedMinutes,
                  locationFlagged: r.checkInSuspect || r.checkOutSuspect || r.checkInSimulated || r.checkOutSimulated,
                  corrected: r.correctedAt ? { at: r.correctedAt.toISOString(), by: r.correctedBy?.name ?? null, reason: r.correctionReason } : null,
                }
              : {}),
          }
        }),
      }
    }),
  }
}

/** Attendance requests (leave, sick, permit, day off…) of the visible people. Default: the ones still pending. */
export async function listAttendanceRequests(
  caller: McpCaller,
  args: { status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; userId?: string; from?: string; to?: string; limit?: number },
) {
  const { workspaceId, people } = await attendanceAudience(caller.userId)
  if (!workspaceId) return { requests: [] }
  const visible = new Set(people.map((p) => p.id))
  if (args.userId && !visible.has(args.userId)) fail("OUTSIDE_APPROVAL_CHAIN", "That person is outside your approval chain (Bagan Approval).")
  const where: Prisma.AttendanceRequestWhereInput = {
    workspaceId,
    userId: { in: args.userId ? [args.userId] : [...visible] },
    status: (args.status ?? "PENDING") as never,
  }
  if (args.from) where.endDate = { gte: parseDateOnlyToUtc(parseDateKey(args.from, "from")) }
  if (args.to) where.startDate = { lte: parseDateOnlyToUtc(parseDateKey(args.to, "to")) }
  const rows = await prisma.attendanceRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(args.limit ?? 50, 1), 100),
    select: {
      id: true, userId: true, type: true, status: true, startDate: true, endDate: true, reason: true, reviewNote: true, approvalSource: true,
      reviewedById: true, createdAt: true, reviewedAt: true, user: { select: { name: true } }, reviewedBy: { select: { name: true } },
    },
  })
  return {
    requests: rows.map((r) => ({
      id: r.id, person: r.user.name, userId: r.userId, type: r.type, status: r.status,
      startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate.toISOString().slice(0, 10),
      reason: r.reason, reviewNote: r.reviewNote, reviewedBy: r.reviewedBy?.name ?? null,
      autoDeduction: isAutoDeduction(r), createdAt: r.createdAt.toISOString(),
    })),
  }
}

// ─── Correction: preview → confirmation token → apply ──────────────────────────────────────────────────

export type CorrectionKind = "MARK_PRESENT" | "FIX_TIMES"
export type CorrectionInput = { userId: string; date: string; kind: CorrectionKind; checkInAt?: string; checkOutAt?: string | null; reason: string }

/** What apply runs: stored at preview time, never taken from the apply call. */
type StoredChange =
  | { kind: "MARK_PRESENT"; userId: string; workspaceId: string; date: string; body: OverrideBody; coveringIds: string[] }
  | { kind: "FIX_TIMES"; userId: string; workspaceId: string; date: string; recordId: string; body: Record<string, unknown>; expect: { checkInAt: string | null; checkOutAt: string | null } }
  | { kind: "WAIVE_PENALTIES"; userId: string; workspaceId: string; dates: string[]; reason: string; expect: Record<string, string[]> }

/**
 * Fake GPS (owner, 28 Sep 2026: only proof of a fake location makes a day TK): a correction never launders such a
 * day. Ruled INVALID → refused. A record with proof (FAKE) not yet reviewed as valid → refused until a BoD reviews it
 * in Absen Monitor. Weak signals (CHECK / NOFACE) are shown, not refused.
 */
async function locationGuard(
  userId: string,
  date: Date,
  record: Parameters<typeof recordSides>[0] & { id: string } | null,
): Promise<string | null> {
  const invalid = await prisma.attendanceSuspectReview.findFirst({ where: { userId, attendanceDate: date, verdict: "INVALID" }, select: { id: true } })
  if (invalid) fail("FAKE_GPS_RULED", "This day was ruled a fake location (fake GPS) in Absen Monitor. It cannot be corrected through a connected app.")
  if (!record) return null
  const { checkIn, checkOut } = recordSides(record)
  const level = recordLevel([checkIn, checkOut])
  if (level === "FAKE") {
    const review = await prisma.attendanceSuspectReview.findUnique({ where: { recordId: record.id }, select: { verdict: true } })
    if (review?.verdict !== "VALID") fail("FAKE_GPS_UNREVIEWED", "This record carries proof of a fake location and has not been reviewed. Review it in Absen Monitor on the web first.")
  }
  return level
}

const RECORD_SELECT_FOR_GUARD = {
  id: true, checkInAt: true, checkOutAt: true, checkInLat: true, checkInLng: true, checkInAccuracyM: true, checkInSimulated: true, checkInSuspect: true,
  checkInSuspectReason: true, checkInImpliedKmh: true, checkInPhotoUrl: true, checkInAddress: true, checkInOffline: true, checkInFaceCount: true,
  checkOutLat: true, checkOutLng: true, checkOutAccuracyM: true, checkOutSimulated: true, checkOutSuspect: true, checkOutSuspectReason: true,
  checkOutImpliedKmh: true, checkOutPhotoUrl: true, checkOutAddress: true, checkOutOffline: true, checkOutFaceCount: true,
} as const

async function coveringRequests(userId: string, workspaceId: string, date: Date) {
  return prisma.attendanceRequest.findMany({
    where: { userId, workspaceId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true, type: true, status: true, startDate: true, endDate: true, reason: true, reviewedById: true, approvalSource: true },
    orderBy: { id: "asc" },
  })
}

export async function previewAttendanceCorrection(caller: McpCaller, input: CorrectionInput) {
  const ctx = await getAttendanceWorkspaceContext(caller.userId)
  const workspaceId = await assertMayCorrect(caller.userId, input.userId, ctx)

  const dateKey = parseDateKey(input.date, "date")
  const date = parseDateOnlyToUtc(dateKey)
  if (date.getTime() > getAttendanceDate().getTime()) fail("FUTURE_DATE", "Attendance can't be corrected for a future date.")
  const reason = (input.reason ?? "").trim()
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) fail("REASON", `Give a reason of ${REASON_MIN}–${REASON_MAX} characters; it is stored on the record and in the audit.`)
  let checkInAt: Date | undefined
  let checkOutAt: Date | null | undefined
  try {
    checkInAt = parseProposedTime(input.checkInAt, dateKey, "check-in time")
    checkOutAt = input.checkOutAt === null ? null : parseProposedTime(input.checkOutAt, dateKey, "check-out time")
  } catch (e) {
    fail("BAD_TIME", e instanceof Error ? e.message : "Invalid time")
  }

  const [person, record, penalties, classified] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { name: true } }),
    prisma.attendanceRecord.findUnique({
      where: { userId_workspaceId_attendanceDate: { userId: input.userId, workspaceId, attendanceDate: date } },
      include: { officeLocation: true },
    }),
    readAttendancePenaltiesForDate(input.userId, workspaceId, date, dateKey),
    classifyAttendanceDays({ workspaceId, userIds: [input.userId], start: date, end: date }),
  ])
  const flag = await locationGuard(input.userId, date, record)
  const dayBefore = classified.get(input.userId)?.[0]
  const covering = await coveringRequests(input.userId, workspaceId, date)
  const realCovering = covering.filter((r) => !isAutoDeduction(r))
  const penaltySummary = {
    lateXp: penalties.lateXp, noCheckoutXp: penalties.noCheckoutXp, alphaXp: penalties.alphaXp, autoDayOffsDeducted: penalties.autoDayOffs,
  }
  const before = {
    date: dateKey,
    person: person?.name ?? null,
    day: dayBefore ? { dayType: dayBefore.dayType, source: dayBefore.source, requestType: dayBefore.requestType } : { dayType: "NOT_A_WORKDAY_OR_NOTHING_OWED" },
    record: record
      ? { checkIn: wallClock(record.checkInAt), checkOut: wallClock(record.checkOutAt), status: record.status, checkInStatus: record.checkInStatus, lateMinutes: record.lateMinutes, earlyLeaveMinutes: record.earlyLeaveMinutes }
      : null,
    requests: realCovering.map((r) => ({ id: r.id, type: r.type, status: r.status, from: r.startDate.toISOString().slice(0, 10), to: r.endDate.toISOString().slice(0, 10) })),
    penalties: penaltySummary,
    ...(flag ? { locationFlag: flag } : {}),
  }

  let stored: StoredChange
  let after: Record<string, unknown>
  const notes: string[] = []
  // Facts the approval page shows in its own language (the notes are the same in English for the assistant).
  const flags = { checkOutDefaulted: false, multiDayRequestTypes: [] as string[] }
  if (input.kind === "MARK_PRESENT") {
    if (record) fail("HAS_RECORD", "This day already has an attendance record. Use kind FIX_TIMES to change its check-in/check-out.")
    if (!checkInAt) fail("NEEDS_CHECK_IN", "Give the check-in time (HH:mm, WIB) the person actually arrived.")
    const body: OverrideBody = {
      userId: input.userId, date: dateKey, action: "PRESENT", note: reason, checkInAt: checkInAt!.toISOString(),
      ...(checkOutAt !== undefined ? { checkOutAt: checkOutAt ? checkOutAt.toISOString() : null } : {}),
    }
    const times = await resolveOverridePresentTimes(workspaceId, input.userId, date, body)
    if (!times.ok) fail("REFUSED", times.error)
    const t = times as Extract<typeof times, { ok: true }>
    const timeError = validateCorrectionTimes(dateKey, t.checkInAt, t.checkOutAt)
    if (timeError) fail("BAD_TIME", timeError)
    const singleDay = covering.filter((r) => r.startDate.getTime() === r.endDate.getTime())
    const multiDay = covering.filter((r) => r.startDate.getTime() !== r.endDate.getTime() && !isAutoDeduction(r))
    flags.checkOutDefaulted = checkOutAt === undefined
    flags.multiDayRequestTypes = multiDay.map((r) => r.type)
    if (checkOutAt === undefined) notes.push("No check-out time was given, so the check-out is the end of the person's shift (as the web board does).")
    if (multiDay.length) notes.push(`A multi-day ${multiDay.map((r) => r.type).join("/")} request covers this day and is NOT changed; the day keeps reading as that request until it is edited on the web.`)
    after = {
      record: {
        checkIn: wallClock(t.checkInAt), checkOut: wallClock(t.checkOutAt), status: t.checkOutAt ? "COMPLETED" : "CHECKED_IN",
        checkInStatus: "ON_TIME", lateMinutes: 0, marked: "corrected by you, with your reason",
      },
      requestsCancelled: singleDay.filter((r) => !isAutoDeduction(r)).map((r) => ({ id: r.id, type: r.type, status: r.status })),
      penaltiesRefunded: penaltySummary,
      xpAndDayOff: "Every attendance penalty of the day is refunded (late / no check-out / absent XP, and an auto-deducted day off is restored).",
    }
    stored = { kind: "MARK_PRESENT", userId: input.userId, workspaceId, date: dateKey, body, coveringIds: covering.map((r) => r.id) }
  } else if (input.kind === "FIX_TIMES") {
    if (!record) fail("NO_RECORD", "There is no attendance record on this day. Use kind MARK_PRESENT to fill it.")
    const rec = record!
    if (checkInAt === undefined && checkOutAt === undefined) fail("NOTHING_TO_CHANGE", "Give checkInAt and/or checkOutAt.")
    const data: Record<string, unknown> = { correctionReason: reason }
    if (checkInAt !== undefined) data.checkInAt = checkInAt.toISOString()
    if (checkOutAt !== undefined) data.checkOutAt = checkOutAt ? checkOutAt.toISOString() : null
    const nextIn = checkInAt ?? rec.checkInAt
    const nextOut = checkOutAt !== undefined ? checkOutAt : rec.checkOutAt
    const timeError = validateCorrectionTimes(dateKey, nextIn, nextOut)
    if (timeError) fail("BAD_TIME", timeError)
    const plan = await planAttendanceRecordCorrection(rec, workspaceId, data as never)
    if (!plan.ok) fail("REFUSED", plan.error)
    const p = plan as Extract<typeof plan, { ok: true }>
    const grace = Math.max(0, p.office.lateGraceMinutes ?? 0)
    const clean = (p.derived.lateMinutes ?? 0) <= grace && Boolean(p.nextCheckOutAt)
    if (sameMinute(rec.checkInAt, p.nextCheckInAt) && sameMinute(rec.checkOutAt, p.nextCheckOutAt)) fail("NOTHING_TO_CHANGE", "Those are already the record's times.")
    after = {
      record: {
        checkIn: wallClock(p.nextCheckInAt), checkOut: wallClock(p.nextCheckOutAt), status: deriveAttendanceStatus(p.nextCheckInAt, p.nextCheckOutAt),
        checkInStatus: p.derived.checkInStatus, checkOutStatus: p.derived.checkOutStatus, lateMinutes: p.derived.lateMinutes,
        earlyLeaveMinutes: p.derived.earlyLeaveMinutes, workedMinutes: p.derived.workedMinutes, marked: "corrected by you, with your reason",
      },
      penalties: clean
        ? { refunded: penaltySummary, why: "The corrected day is on time (within grace) and checked out, so its penalties are refunded." }
        : { kept: penaltySummary, why: "The corrected day is still late or has no check-out, so its penalties stay." },
    }
    stored = {
      kind: "FIX_TIMES", userId: input.userId, workspaceId, date: dateKey, recordId: rec.id, body: data,
      expect: { checkInAt: rec.checkInAt?.toISOString() ?? null, checkOutAt: rec.checkOutAt?.toISOString() ?? null },
    }
  } else {
    return fail("BAD_KIND", "kind must be MARK_PRESENT or FIX_TIMES.")
  }

  const summary = `${input.kind === "MARK_PRESENT" ? "Mark present" : "Fix times"} · ${person?.name ?? input.userId} · ${dateKey}`
  const preview = { summary, kind: input.kind, before, after, reason, notes, flags }
  return createApprovalRequest(caller, input.userId, input.kind, stored, preview)
}

function sameMinute(a: Date | null, b: Date | null) {
  if (!a || !b) return a === b
  return Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000)
}

// ─── Deductions: read the ledger, and ask for a batch waiver ──────────────────────────────────────────

const PERIOD_RE = /^\d{4}-\d{2}$/

/** Uncleared deduction entries per date, read from the same log the crew board shows. */
async function openEntriesByDate(workspaceId: string, userId: string, dateKeys: string[]) {
  const byPeriod = new Map<string, string[]>()
  for (const d of dateKeys) {
    const k = attendancePeriodKey(d)
    byPeriod.set(k, [...(byPeriod.get(k) ?? []), d])
  }
  const out = new Map<string, Array<{ id: string; kind: string; label: string; amount: number; unit: "XP" | "DAY_OFF" }>>()
  const periods = new Map<string, NonNullable<Awaited<ReturnType<typeof readDeductionLog>>>>()
  for (const [period, days] of byPeriod) {
    const log = await readDeductionLog(workspaceId, userId, period)
    if (!log) return fail("NOT_A_MEMBER", "That person is not a member of your workspace.")
    periods.set(period, log)
    for (const d of days) out.set(d, log.entries.filter((e) => e.dateKey === d && !e.cleared).map((e) => ({ id: e.id, kind: e.kind, label: e.label, amount: e.amount, unit: e.unit })))
  }
  return { byDate: out, periods }
}

/**
 * Why a person lost XP / day off in a period: the crew board's deduction log (lib/attendance-deduction-log.ts — the XP
 * ledger and the auto day-off rows, waivers included), with the minutes late of each day from the attendance record,
 * the period's day-off allowance and balance, and the day offs the person asked for.
 */
export async function getAttendanceDeductions(caller: McpCaller, args: { userId: string; period?: string }) {
  const { workspaceId, people } = await attendanceAudience(caller.userId)
  if (!workspaceId) return fail("NO_WORKSPACE", "You are not in a workspace.")
  const person = people.find((p) => p.id === args.userId)
  if (!person) return fail("OUTSIDE_APPROVAL_CHAIN", "That person is outside your approval chain (Bagan Approval).")
  const period = (args.period ?? "").trim() || attendancePeriodKey()
  if (!PERIOD_RE.test(period)) return fail("BAD_PERIOD", "period must be YYYY-MM (attendance period, 28th → 27th).")
  const log = await readDeductionLog(workspaceId, args.userId, period)
  if (!log) return fail("NOT_A_MEMBER", "That person is not a member of your workspace.")
  const { start, end } = attendancePeriodRange(period)
  const [records, dayOffs] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { workspaceId, userId: args.userId, attendanceDate: { gte: start, lte: end } },
      select: { attendanceDate: true, checkInAt: true, checkOutAt: true, lateMinutes: true, checkInStatus: true },
    }),
    prisma.attendanceRequest.findMany({
      where: { workspaceId, userId: args.userId, type: "DAY_OFF", startDate: { lte: end }, endDate: { gte: start } },
      select: { startDate: true, endDate: true, status: true, reason: true, reviewedById: true, approvalSource: true },
      orderBy: { startDate: "asc" },
    }),
  ])
  const rec = new Map(records.map((r) => [r.attendanceDate.toISOString().slice(0, 10), r]))
  const byDate = new Map<string, { date: string; xp: number; dayOff: number; cleared: boolean; items: string[] }>()
  for (const e of log.entries) {
    const d = byDate.get(e.dateKey) ?? { date: e.dateKey, xp: 0, dayOff: 0, cleared: e.cleared, items: [] }
    if (e.unit === "XP") d.xp += e.amount
    else d.dayOff += 1
    d.items.push(e.kind)
    byDate.set(e.dateKey, d)
  }
  return {
    person: person.name,
    period,
    periodRange: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
    dayOff: log.dayOff,
    totalXpLost: log.totalXpLost,
    deductionsByDate: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
      const r = rec.get(d.date)
      return {
        ...d,
        dayOffDeducted: d.dayOff,
        ...(r ? { checkIn: wallClock(r.checkInAt), checkOut: wallClock(r.checkOutAt), checkInStatus: r.checkInStatus, lateMinutes: r.lateMinutes } : { record: "none (absent)" }),
      }
    }),
    entries: log.entries,
    dayOffRequests: dayOffs.map((r) => ({
      from: r.startDate.toISOString().slice(0, 10), to: r.endDate.toISOString().slice(0, 10), status: r.status,
      automaticDeduction: isAutoDeduction(r), reason: r.reason,
    })),
    note: "XP entries with unit XP are XP points (negative = deducted). DAY_OFF entries are day-off allowance cut automatically (late > 120 minutes or absent without notice). cleared = already removed by a BoD.",
  }
}

/**
 * Ask to remove the deductions of some days: the crew board's "remove deduction" (POST /api/attendance/override
 * { action: "CLEAR_PENALTY" }) for each date — it refunds that day's XP penalties, restores an auto-deducted day off and
 * writes the waiver that stops the nightly cron re-applying them. It clears the whole DAY, as on the web. One approval
 * link for the whole batch; nothing is written until the person approves on the web.
 */
export async function previewPenaltyWaiver(caller: McpCaller, input: { userId: string; dates: string[]; reason: string }) {
  const ctx = await getAttendanceWorkspaceContext(caller.userId)
  const workspaceId = await assertMayCorrect(caller.userId, input.userId, ctx)
  const reason = (input.reason ?? "").trim()
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) fail("REASON", `Give a reason of ${REASON_MIN}–${REASON_MAX} characters; it is stored in the audit.`)
  const dates = [...new Set((input.dates ?? []).map((d) => parseDateKey(d, "date")))].sort()
  if (dates.length === 0 || dates.length > 31) fail("BAD_DATES", "Give 1–31 dates (YYYY-MM-DD).")
  const today = getAttendanceDate().getTime()
  if (dates.some((d) => parseDateOnlyToUtc(d).getTime() > today)) fail("FUTURE_DATE", "A date is in the future.")
  for (const d of dates) await locationGuard(input.userId, parseDateOnlyToUtc(d), null)
  const { byDate, periods } = await openEntriesByDate(workspaceId, input.userId, dates)
  const empty = dates.filter((d) => (byDate.get(d) ?? []).length === 0)
  if (empty.length) fail("NOTHING_TO_WAIVE", `No deduction left to remove on ${empty.join(", ")} (none, or already removed). Leave those dates out.`)
  const person = await prisma.user.findUnique({ where: { id: input.userId }, select: { name: true } })

  const items = dates.map((d) => ({ date: d, entries: byDate.get(d)! }))
  const xpBack = items.reduce((s, i) => s + i.entries.filter((e) => e.unit === "XP").reduce((x, e) => x - e.amount, 0), 0)
  const daysBack = items.reduce((s, i) => s + i.entries.filter((e) => e.unit === "DAY_OFF").length, 0)
  const balances = [...periods.entries()].map(([period, log]) => {
    const restored = items.filter((i) => attendancePeriodKey(i.date) === period).reduce((s, i) => s + i.entries.filter((e) => e.unit === "DAY_OFF").length, 0)
    const usedAfter = Math.max(0, (log.dayOff.usedTotal ?? log.dayOff.used) - restored)
    return { period, quota: log.dayOff.quota, remainingBefore: log.dayOff.remaining, remainingAfter: Math.max(0, log.dayOff.quota - usedAfter) }
  })
  const stored: StoredChange = {
    kind: "WAIVE_PENALTIES", userId: input.userId, workspaceId, dates, reason,
    expect: Object.fromEntries(items.map((i) => [i.date, i.entries.map((e) => e.id).sort()])),
  }
  const summary = `Remove deductions · ${person?.name ?? input.userId} · ${dates.length} day${dates.length === 1 ? "" : "s"}`
  const preview = {
    summary, kind: "WAIVE_PENALTIES", reason,
    before: { person: person?.name ?? null, items, balances },
    after: { xpRefunded: xpBack, dayOffsRestored: daysBack, balances },
    notes: ["Each date is cleared as a whole day (every deduction of that date), exactly like the remove button in the deduction log. The person gets a notification per date."],
    flags: null,
  }
  return createApprovalRequest(caller, input.userId, "WAIVE_PENALTIES", stored, preview)
}

/** Store a change behind a fresh approval link (10 minutes, single use) and answer the assistant. */
async function createApprovalRequest(caller: McpCaller, targetUserId: string, kind: string, stored: StoredChange, preview: Record<string, unknown>) {
  const approveSecret = crypto.randomBytes(32).toString("base64url")
  const approveUrl = publicUrl(`approve/mcp/${approveSecret}`)
  if (!approveUrl) fail("NO_PUBLIC_URL", "This server has no public address (NEXUS_PUBLIC_URL), so it cannot make an approval link.")
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS)
  const row = await prisma.mcpConfirmation.create({
    data: {
      tokenHash: hashToken(approveSecret),
      userId: caller.userId,
      apiTokenId: caller.tokenId,
      clientLabel: caller.clientLabel,
      action: `attendance:${kind}`,
      targetUserId,
      payload: stored as unknown as Prisma.InputJsonValue,
      preview: preview as unknown as Prisma.InputJsonValue,
      expiresAt,
    },
    select: { id: true },
  })
  // Best-effort housekeeping: requests are worthless a day after they expire.
  prisma.mcpConfirmation.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => {})
  return {
    ...preview,
    requestId: row.id,
    approveUrl,
    expiresAt: expiresAt.toISOString(),
    nextStep: "Nothing has changed yet. Send approveUrl to the person: they open it, signed in to NEXUS on the web, check everything and tap Approve or Reject there. Nothing you can call applies it. Then call get_attendance_correction_status with requestId to see the outcome. The link works once, within 10 minutes.",
  }
}

// ─── Status (MCP) and the decision (NEXUS web approval page) ───────────────────────────────────────────

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "FAILED"

type Row = NonNullable<Awaited<ReturnType<typeof prisma.mcpConfirmation.findUnique>>>

/** What a request is now: a pending one past its 10 minutes reads EXPIRED (APPROVING = a decision in flight). */
export function effectiveStatus(row: Pick<Row, "status" | "expiresAt">, now = new Date()): ApprovalStatus | "APPROVING" {
  if (row.status === "PENDING" && row.expiresAt.getTime() <= now.getTime()) return "EXPIRED"
  return row.status as ApprovalStatus | "APPROVING"
}

/** MCP: the outcome of one of this connection's requests (another person's or connection's reads as not found). */
export async function getCorrectionStatus(caller: McpCaller, requestId: string) {
  const row = await prisma.mcpConfirmation.findUnique({ where: { id: String(requestId ?? "") } }).catch(() => null)
  if (!row || row.userId !== caller.userId || row.apiTokenId !== caller.tokenId) return fail("NOT_FOUND", "No such correction request for this connection.")
  const status = effectiveStatus(row)
  return {
    requestId: row.id,
    status: status === "APPROVING" ? "PENDING" : status,
    summary: (row.preview as { summary?: string } | null)?.summary ?? null,
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    ...(row.error ? { error: row.error } : {}),
  }
}

/**
 * The CSRF token of the approval page: an HMAC of the request and the signed-in person, under the session secret.
 * GET hands it to the page; POST must send it back (header) — a cross-site form can neither read nor forge it.
 */
export function approvalCsrf(requestId: string, userId: string): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || ""
  if (!secret) throw new Error("AUTH_SECRET missing")
  return crypto.createHmac("sha256", secret).update(`mcp-approval:${requestId}:${userId}`).digest("base64url")
}

function sameCsrf(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** The request behind an approval link, for the signed-in person who owns the connection — anyone else is refused. */
async function rowForSession(secret: string, sessionUserId: string): Promise<Row> {
  const raw = String(secret ?? "").trim()
  if (!raw || raw.length > 200) return fail("NOT_FOUND", "This approval link is not valid.")
  const row = await prisma.mcpConfirmation.findUnique({ where: { tokenHash: hashToken(raw) } })
  if (!row) return fail("NOT_FOUND", "This approval link is not valid.")
  if (row.userId !== sessionUserId) return fail("WRONG_USER", "This approval belongs to another NEXUS account.")
  return row
}

/** GET /api/mcp/approvals/[id]: what the page shows. */
export async function approvalView(secret: string, sessionUserId: string) {
  const row = await rowForSession(secret, sessionUserId)
  const preview = (row.preview ?? {}) as Record<string, unknown>
  const status = effectiveStatus(row)
  return {
    requestId: row.id,
    app: row.clientLabel || "MCP",
    status,
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    error: row.error,
    kind: preview.kind ?? row.action.replace(/^attendance:/, ""),
    reason: preview.reason ?? null,
    before: preview.before ?? null,
    after: preview.after ?? null,
    flags: preview.flags ?? null,
    csrf: approvalCsrf(row.id, sessionUserId),
  }
}

/**
 * POST /api/mcp/approvals/[id] { decision }: the person, signed in on the web, decides. Claimed by one conditional
 * UPDATE (PENDING and not expired → APPROVING / REJECTED), so a double tap or two tabs decide once. Approve then runs
 * the stored change through the web's own code with every check made again now.
 */
export async function decideApproval(opts: {
  secret: string
  session: { id: string; name?: string | null }
  decision: "APPROVE" | "REJECT"
  csrf: string
  request: NextRequest
}) {
  const row = await rowForSession(opts.secret, opts.session.id)
  if (!opts.csrf || !sameCsrf(opts.csrf, approvalCsrf(row.id, opts.session.id))) fail("CSRF", "This page is out of date. Reload it and try again.")
  const now = new Date()
  const claim = await prisma.mcpConfirmation.updateMany({
    where: { id: row.id, status: "PENDING", expiresAt: { gt: now } },
    data: opts.decision === "APPROVE"
      ? { status: "APPROVING", decidedAt: now, decidedById: opts.session.id }
      : { status: "REJECTED", decidedAt: now, decidedById: opts.session.id },
  })
  if (claim.count !== 1) {
    const current = effectiveStatus((await prisma.mcpConfirmation.findUnique({ where: { id: row.id } })) ?? row, now)
    return fail(current === "EXPIRED" ? "EXPIRED" : "ALREADY_DECIDED", current === "EXPIRED" ? "This request expired. Ask for a new one." : `This request was already decided (${current === "APPROVING" ? "PENDING" : current}).`)
  }
  if (opts.decision === "REJECT") return { status: "REJECTED" as const }
  try {
    const result = await executeStoredChange(row, opts.session, opts.request)
    await prisma.mcpConfirmation.update({ where: { id: row.id }, data: { status: "APPROVED", usedAt: new Date(), resultStatus: 200 } })
    return { status: "APPROVED" as const, result }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed"
    await prisma.mcpConfirmation.update({ where: { id: row.id }, data: { status: "FAILED", usedAt: new Date(), error: message.slice(0, 500) } })
    if (e instanceof McpAttendanceError) throw e
    return fail("FAILED", message)
  }
}

/** The stored change, run as the connection's owner through the web's own code, after every check is made again. */
async function executeStoredChange(row: Row, approver: { id: string; name?: string | null }, request: NextRequest) {
  const change = row.payload as unknown as StoredChange
  const ownerId = row.userId
  // The connection must still exist: disconnecting the app withdraws what it asked for.
  const connection = await prisma.apiToken.findUnique({ where: { id: row.apiTokenId }, select: { id: true } })
  if (!connection) fail("DISCONNECTED", "The app that asked for this was disconnected, so the request is withdrawn.")
  // Rights are read again now: a role or the chart may have changed since the preview.
  const ctx = await getAttendanceWorkspaceContext(ownerId)
  const workspaceId = await assertMayCorrect(ownerId, change.userId, ctx)
  if (workspaceId !== change.workspaceId) fail("CHANGED", "Your workspace changed since the request. Ask for a new one.")
  const date = parseDateOnlyToUtc(change.kind === "WAIVE_PENALTIES" ? change.dates[0] : change.date)
  const label = row.clientLabel || "MCP"
  const auditMetadata = {
    via: `${label} (MCP)`, mcpClient: label, mcpConfirmationId: row.id, mcpPreview: row.preview,
    approvedById: approver.id, approvedByName: approver.name ?? null, approvedOn: "NEXUS web approval page",
  }
  const actor = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } })

  if (change.kind === "WAIVE_PENALTIES") {
    // Everything checked BEFORE the first write: the same open deductions per date as when the person was asked.
    for (const d of change.dates) await locationGuard(change.userId, parseDateOnlyToUtc(d), null)
    const { byDate } = await openEntriesByDate(workspaceId, change.userId, change.dates)
    for (const d of change.dates) {
      if ((byDate.get(d) ?? []).map((e) => e.id).sort().join() !== (change.expect[d] ?? []).join()) {
        fail("CHANGED", `The deductions of ${d} changed after the request (removed, or new ones). Nothing was changed; ask for a new one.`)
      }
    }
    const done: Array<{ date: string; refunded: unknown }> = []
    for (const d of change.dates) {
      const res = await applyAttendanceOverride({
        request, session: { user: { id: ownerId, name: actor?.name ?? null } },
        body: { userId: change.userId, date: d, action: "CLEAR_PENALTY", note: change.reason }, evidence: null, auditMetadata,
      })
      const out = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (res.status < 200 || res.status >= 300) {
        fail("REFUSED", `NEXUS refused ${d}: ${typeof out?.error === "string" ? out.error : `HTTP ${res.status}`}. Done before it: ${done.map((x) => x.date).join(", ") || "none"}.`)
      }
      done.push({ date: d, refunded: out?.refunded ?? null })
    }
    emitAttendanceChanged([ownerId], "override", null)
    return { cleared: done }
  }

  let res: Response
  if (change.kind === "MARK_PRESENT") {
    const record = await prisma.attendanceRecord.findUnique({
      where: { userId_workspaceId_attendanceDate: { userId: change.userId, workspaceId, attendanceDate: date } },
      select: RECORD_SELECT_FOR_GUARD,
    })
    if (record) fail("CHANGED", "A record appeared on this day after the request (for example the person checked in). Nothing was changed; ask for a new one.")
    await locationGuard(change.userId, date, null)
    const coveringNow = (await coveringRequests(change.userId, workspaceId, date)).map((r) => r.id)
    if ([...coveringNow].sort().join() !== [...change.coveringIds].sort().join()) fail("CHANGED", "The requests covering this day changed after the request. Nothing was changed; ask for a new one.")
    res = await applyAttendanceOverride({ request, session: { user: { id: ownerId, name: actor?.name ?? null } }, body: change.body, evidence: null, auditMetadata })
  } else {
    const record = await prisma.attendanceRecord.findUnique({ where: { id: change.recordId }, select: RECORD_SELECT_FOR_GUARD })
    if (!record) fail("CHANGED", "The record was removed after the request. Nothing was changed.")
    await locationGuard(change.userId, date, record)
    res = await applyAttendanceRecordCorrection({
      request, session: { user: { id: ownerId } }, recordId: change.recordId, body: change.body, auditMetadata, allowSilent: false,
      expect: { checkInAt: change.expect.checkInAt ? new Date(change.expect.checkInAt) : null, checkOutAt: change.expect.checkOutAt ? new Date(change.expect.checkOutAt) : null },
    })
  }
  const result = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.status >= 200 && res.status < 300) {
    // What pingActorAfter does for the web routes: the person's own open screens refetch.
    emitAttendanceChanged([ownerId], change.kind === "MARK_PRESENT" ? "override" : "correction", change.kind === "MARK_PRESENT" ? null : change.recordId)
    return result
  }
  const code = typeof result?.code === "string" ? result.code : "REFUSED"
  return fail(code === "RECORD_CHANGED" ? "CHANGED" : "REFUSED", typeof result?.error === "string" ? result.error : `NEXUS refused (HTTP ${res.status}).`)
}
