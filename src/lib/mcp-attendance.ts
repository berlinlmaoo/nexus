import crypto from "crypto"
import { NextRequest } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import {
  ATTENDANCE_TIMEZONE,
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

/**
 * Attendance over MCP (owner, 17 Nov 2026: a connected assistant acting as its owner).
 *
 * READ  (scope attendance:read): the people the caller may approve in the Bagan Approval
 *        (lib/attendance-approvers.ts canUserReviewRequest — the one resolver), plus the caller themself.
 *        A Staff member sees only themself. "Staff Management" read-only viewers are NOT widened here.
 * WRITE (scope attendance:write): a correction of one person-day, in two server-enforced steps:
 *   1. preview → validates everything the write would, computes the exact before/after with the same functions the
 *      write uses, and stores the change server-side behind a single-use confirmation token (10 minutes, bound to
 *      the caller, their connection and this exact change). Nothing is written.
 *   2. apply   → only with that token. The stored change (never the caller's arguments) runs through the web's own
 *      code: POST /api/attendance/override (lib/attendance-override.ts) for a missing day marked present, PATCH
 *      /api/attendance/records/[id] (lib/attendance-record-correction.ts) for a time fix. XP refunds, day-off
 *      quota, waivers, outage rules, cancelled single-day requests, notifications, realtime and the audit row are
 *      exactly what the web does — the audit row is the person's, with `via: "<client> (MCP)"`.
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
const TOKEN_PREFIX = "nxk_"

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

  const token = TOKEN_PREFIX + crypto.randomBytes(24).toString("hex")
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS)
  const summary = `${input.kind === "MARK_PRESENT" ? "Mark present" : "Fix times"} · ${person?.name ?? input.userId} · ${dateKey}`
  const preview = { summary, before, after, reason, notes }
  await prisma.mcpConfirmation.create({
    data: {
      tokenHash: hashToken(token),
      userId: caller.userId,
      apiTokenId: caller.tokenId,
      action: `attendance:${input.kind}`,
      targetUserId: input.userId,
      payload: stored as unknown as Prisma.InputJsonValue,
      preview: preview as unknown as Prisma.InputJsonValue,
      expiresAt,
    },
  })
  // Best-effort housekeeping: confirmations are worthless a few minutes after they expire.
  prisma.mcpConfirmation.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => {})
  return {
    ...preview,
    confirmationToken: token,
    expiresAt: expiresAt.toISOString(),
    nextStep: "Nothing has changed yet. Show this before/after to the person and ask them to confirm. Only after they say yes, call apply_attendance_correction with this confirmationToken. It works once, for this exact change, within 10 minutes.",
  }
}

function sameMinute(a: Date | null, b: Date | null) {
  if (!a || !b) return a === b
  return Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000)
}

/**
 * Burn a confirmation token for this caller: one UPDATE that matches only an unused, unexpired token of this person
 * AND this connection, so two concurrent applies cannot both win and nobody else can use it. On a miss, says why.
 */
export async function claimConfirmation(token: string, caller: McpCaller, now = new Date()) {
  const raw = (token ?? "").trim()
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length > 200) fail("TOKEN_INVALID", "That is not a confirmation token. Call preview_attendance_correction first.")
  const tokenHash = hashToken(raw)
  const claimed = await prisma.mcpConfirmation.updateMany({
    where: { tokenHash, userId: caller.userId, apiTokenId: caller.tokenId, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  const row = await prisma.mcpConfirmation.findUnique({ where: { tokenHash } })
  if (claimed.count === 1 && row) return row
  if (!row) return fail("TOKEN_INVALID", "Unknown confirmation token. Call preview_attendance_correction first.")
  if (row.userId !== caller.userId || row.apiTokenId !== caller.tokenId) return fail("TOKEN_NOT_YOURS", "This confirmation token was issued to another person or connection.")
  if (row.usedAt) return fail("TOKEN_USED", "This confirmation token was already used. Preview again for a new change.")
  return fail("TOKEN_EXPIRED", "This confirmation token expired (10 minutes). Preview again.")
}

function mcpRequest(caller: McpCaller, headers?: Record<string, string | string[] | undefined>): NextRequest {
  const h = new Headers({ "user-agent": `NEXUS MCP · ${caller.clientLabel}`, "content-type": "application/json" })
  const fwd = headers?.["x-forwarded-for"] ?? headers?.["x-real-ip"]
  if (typeof fwd === "string" && fwd) h.set("x-forwarded-for", fwd)
  return new NextRequest("http://127.0.0.1/api/mcp", { method: "POST", headers: h })
}

export async function applyAttendanceCorrection(caller: McpCaller, token: string, requestHeaders?: Record<string, string | string[] | undefined>) {
  const row = await claimConfirmation(token, caller)
  const change = row.payload as unknown as StoredChange
  // Rights are read again now: a role or the chart may have changed since the preview.
  const ctx = await getAttendanceWorkspaceContext(caller.userId)
  const workspaceId = await assertMayCorrect(caller.userId, change.userId, ctx)
  if (workspaceId !== change.workspaceId) fail("CHANGED", "Your workspace changed since the preview. Preview again.")
  const date = parseDateOnlyToUtc(change.date)
  const auditMetadata = { via: `${caller.clientLabel} (MCP)`, mcpClient: caller.clientLabel, mcpConfirmationId: row.id, mcpPreview: row.preview }
  const actor = await prisma.user.findUnique({ where: { id: caller.userId }, select: { name: true } })
  const request = mcpRequest(caller, requestHeaders)

  let res: Response
  if (change.kind === "MARK_PRESENT") {
    const record = await prisma.attendanceRecord.findUnique({
      where: { userId_workspaceId_attendanceDate: { userId: change.userId, workspaceId, attendanceDate: date } },
      select: RECORD_SELECT_FOR_GUARD,
    })
    if (record) fail("CHANGED", "A record appeared on this day after the preview (for example the person checked in). Preview again.")
    await locationGuard(change.userId, date, null)
    const coveringNow = (await coveringRequests(change.userId, workspaceId, date)).map((r) => r.id)
    if ([...coveringNow].sort().join() !== [...change.coveringIds].sort().join()) fail("CHANGED", "The requests covering this day changed after the preview. Preview again.")
    res = await applyAttendanceOverride({ request, session: { user: { id: caller.userId, name: actor?.name ?? null } }, body: change.body, evidence: null, auditMetadata })
  } else {
    const record = await prisma.attendanceRecord.findUnique({ where: { id: change.recordId }, select: RECORD_SELECT_FOR_GUARD })
    if (!record) fail("CHANGED", "The record was removed after the preview.")
    await locationGuard(change.userId, date, record)
    res = await applyAttendanceRecordCorrection({
      request, session: { user: { id: caller.userId } }, recordId: change.recordId, body: change.body, auditMetadata, allowSilent: false,
      expect: { checkInAt: change.expect.checkInAt ? new Date(change.expect.checkInAt) : null, checkOutAt: change.expect.checkOutAt ? new Date(change.expect.checkOutAt) : null },
    })
  }
  const result = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.status >= 200 && res.status < 300) {
    // What pingActorAfter does for the web routes: the caller's own open screens refetch.
    emitAttendanceChanged([caller.userId], change.kind === "MARK_PRESENT" ? "override" : "correction", change.kind === "MARK_PRESENT" ? null : change.recordId)
    await prisma.mcpConfirmation.update({ where: { id: row.id }, data: { resultStatus: res.status } }).catch(() => {})
    return { applied: true, summary: (row.preview as { summary?: string } | null)?.summary ?? null, result }
  }
  await prisma.mcpConfirmation.update({ where: { id: row.id }, data: { resultStatus: res.status } }).catch(() => {})
  return fail("REFUSED", typeof result?.error === "string" ? `NEXUS refused: ${result.error}` : `NEXUS refused (HTTP ${res.status}).`)
}
