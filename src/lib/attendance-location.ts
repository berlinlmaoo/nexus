import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { buildAttendanceDerivedFields, formatAttendanceDateKey, resolveEffectiveAttendanceShift } from "@/lib/attendance"
import { isAutoDeduction } from "@/lib/attendance-absence"
import { resolveAttendanceApprovers } from "@/lib/attendance-approvers"
import { isHoliday } from "@/lib/holidays"
import { createInAppNotification, notifyOffsiteCheckoutPending } from "@/lib/notification-service"
import { reverseGeocodeCoordinates } from "@/lib/reverse-geocode"
import { isCheckInAway, placeLabel } from "@/lib/attendance-place"
import { createLogger } from "@/lib/logger"
import { getAppSetting } from "@/lib/app-setting"
import { getAppConfig } from "@/lib/app-config"
import {
  OUTSIDE_PERMIT_LINK,
  OUTSIDE_PUSH_CATEGORY,
  OUTSIDE_STALE_MIN,
  autoCheckoutReason,
  classifyPoint,
  currentOutsideSince,
  decideOutsideStep,
  excuseEffect,
  outsidePushCopy,
  outsideApproverCopy,
  outsideSpans,
  presenceHours,
  stageAfter,
  type ClassifiedPoint,
  type Fire,
  type OfficeGeo,
  type ResponseStage,
  type TrailPointInput,
} from "@/lib/attendance-outside"

/**
 * Live location while checked in — the database side. Decisions live in attendance-outside.ts (pure,
 * unit-tested); this file loads, writes, and sends.
 *
 * Callers:
 *   POST /api/attendance/location-trail   ingestTrailPoints → advanceOutsideClock
 *   POST /api/attendance/location-status  (writes locationTrackingState directly)
 *   POST /api/cron/attendance-outside     every minute (nexus-cron-menit): advanceOutsideClock per record
 *   GET  /api/attendance/records/[id]/trail  buildRecordTrail
 *
 * Every stage transition is a CONDITIONAL write on the exact state it was decided from
 * (outsideSince + outsideStage + outsideStageAt, record still open). The upload route and the cron may
 * both decide the same step in the same second; only the one whose write lands sends anything.
 */

const log = createLogger("attendance-outside")
const MIN = 60_000

const recordInclude = {
  officeLocation: true,
  user: { select: { id: true, name: true, email: true } },
} as const

type RecordForClock = NonNullable<Awaited<ReturnType<typeof loadRecord>>>

function loadRecord(recordId: string) {
  return prisma.attendanceRecord.findUnique({ where: { id: recordId }, include: recordInclude })
}

export function isOpenRecord(r: { status: string; checkOutAt: Date | null; checkInAt: Date | null }): boolean {
  return r.status === "CHECKED_IN" && r.checkOutAt === null && r.checkInAt !== null
}

/**
 * Whether this record is tracked at all. The same exemptions the check-in route and lib/attendance.ts
 * already apply, read from the same places:
 *   - BoD / One Above All are exempt from attendance (check-in route: exemptFromPenalty).
 *   - Custom/Mobile attendance (WorkspaceMember.noGeofenceMode, getMemberNoGeofence) may be anywhere.
 *   - Only SELF check-ins: those always carry a selfie. BoD "Hadir" overrides and complaint
 *     corrections create records without one.
 *   - Only check-ins AT an office (within its radius — which every geofenced self check-in is).
 *   - A web check-in is not tracked (the browser cannot report a trail): the board says so.
 */
export async function trackingEligibility(record: {
  userId: string
  workspaceId: string
  checkInPhotoUrl: string | null
  checkInDistanceMeters: number | null
  checkInClient: string | null
  officeLocation: { radiusMeters: number }
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: record.userId, workspaceId: record.workspaceId } },
    select: { role: true, noGeofenceMode: true },
  })
  if (!member) return { ok: false, reason: "not_a_member" }
  // Testers (AppSetting "location-tracking-testers": string[] of user ids) are tracked even when their
  // role or Custom attendance would exempt them — so the owner can walk the whole flow on his own
  // phone. Everything after these two exemptions still applies to them.
  const testers = await getAppSetting<string[]>("location-tracking-testers").catch(() => null)
  const isTester = Array.isArray(testers) && testers.includes(record.userId)
  if (!isTester && (member.role === "BOD" || member.role === "ONE_ABOVE_ALL")) return { ok: false, reason: "exempt_role" }
  if (!isTester && member.noGeofenceMode) return { ok: false, reason: "no_geofence" }
  if (!record.checkInPhotoUrl) return { ok: false, reason: "not_self_checkin" }
  if (record.checkInDistanceMeters !== null && record.checkInDistanceMeters > record.officeLocation.radiusMeters) {
    return { ok: false, reason: "not_at_office" }
  }
  if (record.checkInClient === "web") return { ok: false, reason: "web_checkin" }
  return { ok: true }
}

/** Every active office of the workspace, plus the one checked in at (even if since archived). */
export async function officesForRecord(record: { workspaceId: string; officeLocation: OfficeGeo & { id: string } }): Promise<OfficeGeo[]> {
  const active = await prisma.officeLocation.findMany({
    where: { workspaceId: record.workspaceId, isActive: true, archivedAt: null },
    select: { id: true, latitude: true, longitude: true, radiusMeters: true },
  })
  const list: OfficeGeo[] = active.map((o) => ({ latitude: o.latitude, longitude: o.longitude, radiusMeters: o.radiusMeters }))
  if (!active.some((o) => o.id === record.officeLocation.id)) {
    list.push({ latitude: record.officeLocation.latitude, longitude: record.officeLocation.longitude, radiusMeters: record.officeLocation.radiusMeters })
  }
  return list
}

async function classifiedPointsOf(recordId: string, offices: OfficeGeo[]) {
  const rows = await prisma.attendanceLocationPoint.findMany({
    where: { recordId },
    orderBy: { at: "asc" },
    select: { lat: true, lng: true, accuracy: true, at: true, event: true, inside: true },
  })
  const classified: (ClassifiedPoint & { lat: number; lng: number; accuracy: number | null; inside: boolean })[] = rows.map((r) => {
    const c = classifyPoint(r, offices)
    return { ...r, cls: c.cls, distanceMeters: c.distanceMeters }
  })
  return classified
}

/**
 * Re-derive the current outside episode from ALL of the record's points and store it when it changed.
 * Recomputing from scratch is what makes an offline queue arriving out of order harmless.
 *
 *   new episode (none before, or starts after the stored one — they came back in between)
 *       → outsideSince = its start, stage "outside" (nothing fired yet)
 *   same episode, proven earlier by late-arriving points → outsideSince moves earlier, stage kept
 *   inside → outsideSince = null, stage null (re-entering the radius resets the clock)
 */
async function syncOutsideEpisode(record: RecordForClock, offices: OfficeGeo[], now: Date) {
  const points = await classifiedPointsOf(record.id, offices)
  const since = currentOutsideSince(points)
  const stored = record.outsideSince
  if ((since?.getTime() ?? null) === (stored?.getTime() ?? null)) return record

  let data: { outsideSince: Date | null; outsideStage?: string | null; outsideStageAt?: Date | null }
  if (!since) data = { outsideSince: null, outsideStage: null, outsideStageAt: null }
  else if (stored && since < stored) data = { outsideSince: since }
  else data = { outsideSince: since, outsideStage: "outside", outsideStageAt: now }

  const res = await prisma.attendanceRecord.updateMany({
    where: { id: record.id, status: "CHECKED_IN", checkOutAt: null, outsideSince: stored },
    data,
  })
  // Lost a race with another upload: whatever it wrote is the newer truth, read it back.
  return res.count === 1 ? { ...record, ...data } : ((await loadRecord(record.id)) ?? record)
}

export type IngestResult = {
  tracking: boolean
  reason?: string
  recordId: string | null
  accepted: number
  ignored: number
}

/**
 * Store a batch of points for the user's open record. Points outside check-in → now (+1 min of clock
 * skew) are ignored; (userId, at) is unique, so a replayed batch stores nothing twice.
 */
export async function ingestTrailPoints(userId: string, recordId: string | null, points: TrailPointInput[], now = new Date()): Promise<IngestResult & { record: RecordForClock | null }> {
  const record = await prisma.attendanceRecord.findFirst({
    where: { userId, ...(recordId ? { id: recordId } : { status: "CHECKED_IN", checkOutAt: null, checkInAt: { not: null } }) },
    orderBy: { attendanceDate: "desc" },
    include: recordInclude,
  })
  if (!record) return { tracking: false, reason: "no_open_record", recordId: null, accepted: 0, ignored: points.length, record: null }
  if (!isOpenRecord(record)) return { tracking: false, reason: "record_closed", recordId: record.id, accepted: 0, ignored: points.length, record }
  const eligible = await trackingEligibility(record)
  if (!eligible.ok) return { tracking: false, reason: eligible.reason, recordId: record.id, accepted: 0, ignored: points.length, record }

  const from = record.checkInAt!.getTime()
  const to = now.getTime() + MIN
  const inWindow = points.filter((p) => p.at.getTime() >= from && p.at.getTime() <= to)
  const offices = await officesForRecord(record)
  let accepted = 0
  if (inWindow.length > 0) {
    const res = await prisma.attendanceLocationPoint.createMany({
      data: inWindow.map((p) => ({
        userId,
        recordId: record.id,
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy,
        at: p.at,
        event: p.event,
        inside: classifyPoint(p, offices).cls === "inside",
      })),
      skipDuplicates: true,
    })
    accepted = res.count
  }
  // Points arriving = tracking works — when the app has not said anything yet. An explicit "denied"
  // (Always refused) is NOT overwritten: since the presence checks, a While-Using phone sends points
  // whenever the app is open, even inside, and that must not clear the board's "Location off". A
  // later grant is reported by the app itself (location-status → "on").
  if (inWindow.length > 0 && record.locationTrackingState == null) {
    await prisma.attendanceRecord.update({ where: { id: record.id }, data: { locationTrackingState: "on" } })
    record.locationTrackingState = "on"
  }
  const synced = await syncOutsideEpisode(record, offices, now)
  return { tracking: true, recordId: record.id, accepted, ignored: points.length - accepted, record: synced as RecordForClock }
}

export type ClockResult = {
  recordId: string
  userId: string
  name: string | null
  tracking: boolean
  skipped?: string
  outsideSince: string | null
  clockFrom: string | null
  minutesOutside: number
  stage: ResponseStage
  nextAt: string | null
  autoAt: string | null
  paused: boolean
  stale: boolean
  lastPointAt: string | null
  /** What was due this tick; `fired` says whether this call carried it out (false on a dry run or a lost race). */
  due: Fire | null
  fired: boolean
}

/**
 * One tick for one record: is a reminder / warning / automatic check-out due, and if so do it (once).
 * `dryRun` decides and reports without writing or sending anything.
 */
export async function advanceOutsideClock(recordId: string, opts: { now?: Date; dryRun?: boolean } = {}): Promise<ClockResult> {
  const now = opts.now ?? new Date()
  const record = await loadRecord(recordId)
  const blank = {
    recordId,
    userId: record?.userId ?? "",
    name: record?.user?.name ?? null,
    outsideSince: record?.outsideSince?.toISOString() ?? null,
    clockFrom: null,
    minutesOutside: 0,
    nextAt: null,
    autoAt: null,
    paused: false,
    stale: false,
    lastPointAt: null,
    due: null,
    fired: false,
  }
  if (!record) return { ...blank, tracking: false, skipped: "not_found", stage: "inside" }
  if (!isOpenRecord(record)) {
    return { ...blank, tracking: false, skipped: "record_closed", stage: record.outsideStage === "auto_checked_out" ? "auto_checked_out" : "inside" }
  }
  const eligible = await trackingEligibility(record)
  if (!eligible.ok) return { ...blank, tracking: false, skipped: eligible.reason, stage: "inside" }

  // Excuses covering the record's day — the same query shape as the check-in route (auto-deductions
  // are the cron's own penalty rows, not an excuse anyone filed, so they never pause anything).
  const excuses = (
    await prisma.attendanceRequest.findMany({
      where: {
        userId: record.userId,
        workspaceId: record.workspaceId,
        startDate: { lte: record.attendanceDate },
        endDate: { gte: record.attendanceDate },
      },
      select: { status: true, reviewedAt: true, updatedAt: true, reason: true, reviewedById: true, approvalSource: true },
    })
  )
    .filter((r) => !isAutoDeduction(r))
    // A withdrawal (CANCELED) sets no reviewedAt; updatedAt is when it happened.
    .map((r) => ({ status: r.status, resolvedAt: r.reviewedAt ?? r.updatedAt }))
  const { paused, restartAt } = excuseEffect(excuses)

  const last = await prisma.attendanceLocationPoint.findFirst({
    where: { recordId: record.id },
    orderBy: { at: "desc" },
    select: { at: true },
  })
  // The automatic check-out is a remote-config switch, off since 8 Oct 2026 (owner).
  const autoCheckout = (await getAppConfig(null).catch(() => null))?.flags.outsideAutoCheckout === true
  const step = decideOutsideStep({
    now,
    outsideSince: record.outsideSince,
    stage: record.outsideStage,
    stageAt: record.outsideStageAt,
    paused,
    restartAt,
    autoCheckout,
  })
  // The phone went quiet while outside. As far as we know they are still out, so the clock keeps
  // running on server time; the pushes say so in their data (`stale`).
  const stale = Boolean(record.outsideSince) && (!last || now.getTime() - last.at.getTime() > OUTSIDE_STALE_MIN * MIN)

  const result: ClockResult = {
    ...blank,
    tracking: true,
    outsideSince: record.outsideSince?.toISOString() ?? null,
    clockFrom: step.clockFrom?.toISOString() ?? null,
    minutesOutside: step.minutesOutside,
    stage: step.stage,
    nextAt: step.nextAt?.toISOString() ?? null,
    autoAt: step.autoAt?.toISOString() ?? null,
    paused,
    stale,
    lastPointAt: last?.at.toISOString() ?? null,
    due: step.fire,
  }
  if (!step.fire || opts.dryRun || !record.outsideSince) return result

  const tz = record.officeLocation.timezone || "Asia/Jakarta"
  const pushData = {
    recordId: record.id,
    outsideSince: record.outsideSince.toISOString(),
    stale,
    lastPointAt: last?.at.toISOString() ?? null,
    autoAt: step.autoAt?.toISOString() ?? null,
  }

  if (step.fire === "auto") {
    const ok = await autoOffsiteCheckout(record, now, { stale, lastPointAt: last?.at ?? null, pushData })
    return { ...result, fired: ok, stage: ok ? "auto_checked_out" : result.stage, nextAt: ok ? null : result.nextAt }
  }

  const res = await prisma.attendanceRecord.updateMany({
    where: {
      id: record.id,
      status: "CHECKED_IN",
      checkOutAt: null,
      outsideSince: record.outsideSince,
      outsideStage: record.outsideStage,
      outsideStageAt: record.outsideStageAt,
    },
    data: { outsideStage: step.nextStoredStage, outsideStageAt: now },
  })
  if (res.count !== 1) return result // someone else moved it first

  // `now`: the time left in the text is counted from the tick that decided this step.
  const copy = outsidePushCopy(step.fire, { minutesOutside: step.minutesOutside, autoAt: step.autoAt, outsideSince: record.outsideSince, timeZone: tz, now })
  // Sent regardless of do-not-disturb: this is not a nudge whose moment passes but the notice before
  // an automatic check-out. Staying silent would check someone out without telling them first.
  await createInAppNotification({
    userId: record.userId,
    type: copy.type,
    title: copy.title,
    message: copy.body,
    link: OUTSIDE_PERMIT_LINK,
    push: true,
    pushCategory: OUTSIDE_PUSH_CATEGORY,
    pushData,
  }).catch((error) => log.error("outside push failed", { recordId: record.id, fire: step.fire, error: String(error) }))
  log.info("outside stage", { recordId: record.id, userId: record.userId, stage: step.nextStoredStage, minutesOutside: step.minutesOutside, stale })
  // Their approvers hear about it once per episode (owner, 8 Oct 2026): with the reminder at 1 h 30,
  // or with the warning when a phone that reported late skipped the reminder.
  if (step.fire === "reminder" || (step.fire === "warning" && step.stage === "outside")) {
    await notifyOutsideApprovers(record, step.minutesOutside, tz, pushData)
  }
  return { ...result, fired: true, stage: stageAfter(step) }
}

/** One push to each of the staff member's attendance approvers (never the staff member themselves). */
async function notifyOutsideApprovers(
  record: RecordForClock,
  minutesOutside: number,
  tz: string,
  pushData: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    const { userIds } = await resolveAttendanceApprovers(record.userId, record.workspaceId)
    const copy = outsideApproverCopy({ name: record.user?.name ?? null, minutesOutside, outsideSince: record.outsideSince!, timeZone: tz })
    for (const userId of userIds) {
      if (userId === record.userId) continue
      await createInAppNotification({
        userId,
        type: copy.type,
        title: copy.title,
        message: copy.body,
        link: "/attendance",
        push: true,
        pushData: { ...pushData, staffUserId: record.userId },
      }).catch((error) => log.error("outside approver push failed", { recordId: record.id, approverId: userId, error: String(error) }))
    }
    log.info("outside approvers notified", { recordId: record.id, approvers: userIds.length })
  } catch (error) {
    log.error("outside approvers lookup failed", { recordId: record.id, error: String(error) })
  }
}

/**
 * The automatic offsite check-out — the SAME state the check-out route writes for a manual offsite
 * check-out (checkOutOffsite true, checkOutApproval PENDING, a reason), so the existing queue
 * (GET /api/attendance/offsite-checkouts), the approve/reject route (reject = −25 "no checkout"),
 * the escalation cron and both clients handle it with no change. Differences, all deliberate:
 *
 *   - checkOutAt is the moment they LEFT the radius, not now.
 *   - No selfie, and no daily reflection: nobody is at the phone to write one. checkOutReflection
 *     stays null (as on every record from before reflections were required); reports count the day as
 *     "no reflection", which is true. The reason's "Auto:" prefix is the flag that says why.
 *   - The late / no-checkout XP rules of the check-out route are not run: the check-out time is the
 *     same day, so the "forgotten check-out" rule could never match, and a rejected auto check-out
 *     already costs −25 through the approve/reject route, exactly like a rejected manual one.
 *   - GIDEON's reflection summary is not requested (there is no reflection).
 */
async function autoOffsiteCheckout(
  record: RecordForClock,
  now: Date,
  ctx: { stale: boolean; lastPointAt: Date | null; pushData: Record<string, string | number | boolean | null> },
): Promise<boolean> {
  const outsideSince = record.outsideSince!
  const tz = record.officeLocation.timezone || "Asia/Jakarta"
  const reason = autoCheckoutReason(outsideSince, tz)

  const effectiveShift = await resolveEffectiveAttendanceShift({
    userId: record.userId,
    workspaceId: record.workspaceId,
    office: record.officeLocation,
    date: record.attendanceDate,
  })
  const derived = buildAttendanceDerivedFields({
    attendanceDate: record.attendanceDate,
    checkInAt: record.checkInAt,
    checkOutAt: outsideSince,
    office: record.officeLocation,
    effectiveShift,
    treatAsNonWorkday: await isHoliday(record.workspaceId, record.attendanceDate),
  })

  // Where they were when they left: the fix that proved it.
  const leftAt = await prisma.attendanceLocationPoint.findFirst({
    where: { recordId: record.id, at: { gte: outsideSince } },
    orderBy: { at: "asc" },
    select: { lat: true, lng: true, accuracy: true },
  })
  let distance: number | null = null
  let address: string | null = null
  if (leftAt) {
    distance = classifyPoint(leftAt, await officesForRecord(record)).distanceMeters
    try {
      address = (await reverseGeocodeCoordinates(leftAt.lat, leftAt.lng)).displayName ?? null
    } catch {
      address = null
    }
  }

  const res = await prisma.attendanceRecord.updateMany({
    where: {
      id: record.id,
      status: "CHECKED_IN",
      checkOutAt: null,
      outsideSince,
      outsideStage: "warned",
      outsideStageAt: record.outsideStageAt,
    },
    data: {
      checkOutAt: outsideSince,
      checkOutStatus: derived.checkOutStatus,
      earlyLeaveMinutes: derived.earlyLeaveMinutes,
      workedMinutes: derived.workedMinutes,
      attendanceFlexi: derived.attendanceFlexi,
      checkOutLat: leftAt?.lat ?? null,
      checkOutLng: leftAt?.lng ?? null,
      checkOutAccuracyM: leftAt?.accuracy ?? null,
      checkOutAddress: address,
      checkOutDistanceMeters: distance,
      checkOutOffsite: true,
      checkOutApproval: "PENDING",
      checkOutReason: reason,
      status: derived.status,
      outsideStage: "auto_checked_out",
      outsideStageAt: now,
    },
  })
  if (res.count !== 1) return false // they checked out themselves, came back, or another tick won

  const staffName = record.user?.name || record.user?.email || "Staff"
  await logAudit({
    action: "update",
    entityType: "attendance_record",
    entityId: record.id,
    entityName: `${staffName} check-out otomatis (di luar kantor)`,
    userId: record.userId,
    metadata: {
      offsite: true,
      auto: true,
      outsideSince: outsideSince.toISOString(),
      stale: ctx.stale,
      lastPointAt: ctx.lastPointAt?.toISOString() ?? null,
      dateKey: formatAttendanceDateKey(record.attendanceDate),
    },
  }).catch(() => null)

  // Approvers: the same call the check-out route makes for a manual offsite check-out.
  await notifyOffsiteCheckoutPending({
    workspaceId: record.workspaceId,
    staffUserId: record.userId,
    staffName,
    reason,
    recordId: record.id,
  }).catch((err) => log.error("offsite checkout notify (auto) failed", { recordId: record.id, error: String(err) }))

  const mode = (await resolveAttendanceApprovers(record.userId, record.workspaceId).catch(() => null))?.mode
  const copy = outsidePushCopy("auto", { minutesOutside: 0, autoAt: null, outsideSince, timeZone: tz, approverMode: mode })
  await createInAppNotification({
    userId: record.userId,
    type: copy.type,
    title: copy.title,
    message: copy.body,
    link: "/attendance",
    push: true,
    pushData: ctx.pushData,
  }).catch((error) => log.error("auto checkout push failed", { recordId: record.id, error: String(error) }))
  log.info("auto offsite checkout", { recordId: record.id, userId: record.userId, outsideSince: outsideSince.toISOString(), stale: ctx.stale })
  return true
}

/** Records the per-minute clock has to look at: open, and outside right now. */
export async function recordsOutsideNow(): Promise<string[]> {
  const rows = await prisma.attendanceRecord.findMany({
    where: { status: "CHECKED_IN", checkOutAt: null, outsideSince: { not: null } },
    select: { id: true },
    orderBy: { outsideSince: "asc" },
    take: 500,
  })
  return rows.map((r) => r.id)
}

/** GET /api/attendance/records/[recordId]/trail — the path and its outside episodes. */
export async function buildRecordTrail(record: RecordForClock) {
  const offices = await officesForRecord(record)
  const points = await classifiedPointsOf(record.id, offices)
  const spans = outsideSpans(points)
  const lastAt = points.length ? points[points.length - 1].at : null
  // An episode still open when the record closed ends when the record did: the manual check-out, or
  // for an automatic one the moment it happened (outsideStageAt) — not checkOutAt, which is the moment
  // they left and so equals the episode's own start.
  const closedAt = !isOpenRecord(record)
    ? record.outsideStage === "auto_checked_out"
      ? record.outsideStageAt ?? record.checkOutAt
      : record.checkOutAt
    : null
  const spansClosed = spans.map((s) => {
    let to = s.to
    if (!to && closedAt) to = new Date(Math.max(closedAt.getTime(), lastAt?.getTime() ?? 0, s.from.getTime()))
    return { from: s.from, to }
  })
  const outsideSpansOut = spansClosed.map((s) => ({ from: s.from.toISOString(), to: s.to ? s.to.toISOString() : null }))
  // Hourly presence (see presenceHours). None for a web check-in: nothing on that day could report.
  const radius = record.officeLocation?.radiusMeters ?? 0
  const webDay = record.checkInClient === "web" || record.locationTrackingState === "web"
  const presence = webDay
    ? []
    : presenceHours({
        checkInAt: record.checkInAt,
        checkInInside: record.checkInDistanceMeters === null || record.checkInDistanceMeters <= radius,
        // Closed without a check-out time (not a normal close): the last update is when it ended.
        closedAt: closedAt ?? (isOpenRecord(record) ? null : record.updatedAt),
        checkOutInsideAt:
          record.checkOutAt && !record.checkOutOffsite && record.checkOutDistanceMeters !== null && record.checkOutDistanceMeters <= radius
            ? record.checkOutAt
            : null,
        now: new Date(),
        points,
        spans: spansClosed,
        timeZone: record.officeLocation?.timezone || "Asia/Jakarta",
      })
  return {
    record: {
      id: record.id,
      userId: record.userId,
      userName: record.user?.name ?? null,
      date: record.attendanceDate.toISOString().slice(0, 10),
      checkInAt: record.checkInAt?.toISOString() ?? null,
      checkOutAt: record.checkOutAt?.toISOString() ?? null,
      checkOutOffsite: record.checkOutOffsite,
      locationTrackingState: record.locationTrackingState ?? null,
      // Where the day was, for the dialog title: the check-in address when it was away from the
      // office (location-free members), else the office name. Additive: older clients read office.
      checkInAway: isCheckInAway(record),
      checkInAddress: record.checkInAddress ?? null,
      placeLabel: placeLabel(record) || null,
      office: record.officeLocation
        ? {
            name: record.officeLocation.name,
            lat: record.officeLocation.latitude,
            lng: record.officeLocation.longitude,
            radiusMeters: record.officeLocation.radiusMeters,
          }
        : null,
    },
    points: points.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      at: p.at.toISOString(),
      inside: p.inside,
      event: p.event ?? null,
    })),
    outsideSpans: outsideSpansOut,
    presence: presence.map((h) => ({
      from: h.from.toISOString(),
      to: h.to.toISOString(),
      label: h.label,
      status: h.status,
      at: h.at ? h.at.toISOString() : null,
    })),
  }
}

export { loadRecord as loadRecordForTrail }
