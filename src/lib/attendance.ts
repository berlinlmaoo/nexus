import prisma from "@/lib/prisma"

export const ATTENDANCE_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Jakarta"
const DEFAULT_SILENT_CORRECTION_ADMINS = ["bagasputro.bp@gmail.com"]
const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5, 6, 7]

type OfficeLocationLike = {
  id: string
  name: string
  address?: string | null
  latitude: number
  longitude: number
  radiusMeters: number
  timezone?: string | null
  workdays?: number[] | null
  shiftStartTime?: string | null
  shiftEndTime?: string | null
  lateGraceMinutes?: number | null
  earlyLeaveGraceMinutes?: number | null
  isActive: boolean
}

type AttendanceRecordWithRelations = {
  id: string
  attendanceDate: Date
  checkInAt: Date | null
  checkOutAt: Date | null
  effectiveShiftSource?: "OFFICE" | "TEAM" | "USER" | null
  effectiveTeamId?: string | null
  effectiveTeamName?: string | null
  effectiveShiftStartTime?: string | null
  effectiveShiftEndTime?: string | null
  checkInStatus?: "ON_TIME" | "LATE" | null
  checkOutStatus?: "ON_TIME" | "EARLY_LEAVE" | "OVERTIME" | null
  lateMinutes?: number | null
  earlyLeaveMinutes?: number | null
  workedMinutes?: number | null
  checkInLat: number | null
  checkInLng: number | null
  checkOutLat: number | null
  checkOutLng: number | null
  checkInAddress: string | null
  checkOutAddress: string | null
  checkInPhotoUrl: string | null
  checkOutPhotoUrl: string | null
  checkInDistanceMeters: number | null
  checkOutDistanceMeters: number | null
  checkOutOffsite?: boolean | null
  checkOutApproval?: string | null
  checkOutReason?: string | null
  checkOutReflection?: string | null
  checkOutReflectionAt?: Date | null
  attendanceFlexi?: boolean | null
  checkOutApprovedById?: string | null
  checkOutApprovedAt?: Date | null
  notes: string | null
  status: "CHECKED_IN" | "COMPLETED" | "INCOMPLETE"
  correctedAt: Date | null
  correctionReason: string | null
  officeLocation: OfficeLocationLike
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
  }
  correctedBy?: {
    id: string
    name: string
    email: string
  } | null
}

type AttendanceRequestWithRelations = {
  id: string
  startDate: Date
  endDate: Date
  type: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF" | "RED_DATE"
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED"
  reason: string
  reviewNote: string | null
  approvalSource: "ADMIN" | "ATTENDANCE_SUPERVISOR" | "TEAM_HEAD" | null
  supportingDocumentUrl: string | null
  supportingDocumentName: string | null
  createdAt: Date
  updatedAt: Date
  reviewedAt: Date | null
  workspaceId: string
  userId: string
  teamId: string | null
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
  }
  reviewedBy: {
    id: string
    name: string
    email: string
  } | null
  team: {
    id: string
    name: string
  } | null
}

export type AttendanceDayType =
  | "PRESENT"
  | "LEAVE_APPROVED"
  | "SICK_APPROVED"
  | "PERMIT_APPROVED"
  | "DAY_OFF_APPROVED"
  | "ABSENT"

type AttendanceRecordInput = Pick<
  AttendanceRecordWithRelations,
  | "attendanceDate"
  | "checkInAt"
  | "checkOutAt"
  | "effectiveShiftSource"
  | "effectiveTeamId"
  | "effectiveTeamName"
  | "effectiveShiftStartTime"
  | "effectiveShiftEndTime"
  | "checkInStatus"
  | "checkOutStatus"
  | "lateMinutes"
  | "earlyLeaveMinutes"
  | "workedMinutes"
  | "attendanceFlexi"
  | "correctedAt"
  | "correctionReason"
> & {
  correctedBy?: AttendanceRecordWithRelations["correctedBy"]
  officeLocation: OfficeLocationLike
}

type AttendanceDerivedMetrics = {
  checkInStatus: "ON_TIME" | "LATE" | null
  checkOutStatus: "ON_TIME" | "EARLY_LEAVE" | "OVERTIME" | null
  lateMinutes: number
  earlyLeaveMinutes: number
  workedMinutes: number
  timeZone: string
  workdays: number[]
  shiftStartTime: string
  shiftEndTime: string
  lateGraceMinutes: number
  earlyLeaveGraceMinutes: number
  shiftStartAt: Date | null
  shiftEndAt: Date | null
  effectiveShiftSource: "OFFICE" | "TEAM" | "USER"
  effectiveTeamId: string | null
  effectiveTeamName: string | null
}

export function safeAttendanceTimezone(timeZone: string | null | undefined) {
  return timeZone?.trim() || ATTENDANCE_TIMEZONE
}

function getDateParts(date: Date, timeZone = ATTENDANCE_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === "year")?.value ?? "1970"
  const month = parts.find((part) => part.type === "month")?.value ?? "01"
  const day = parts.find((part) => part.type === "day")?.value ?? "01"

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    key: `${year}-${month}-${day}`,
  }
}

function getDateTimeParts(date: Date, timeZone = ATTENDANCE_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  const parts = formatter.formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes, fallback: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? fallback)

  return {
    year: read("year", "1970"),
    month: read("month", "1"),
    day: read("day", "1"),
    hour: read("hour", "0"),
    minute: read("minute", "0"),
    second: read("second", "0"),
    key: `${parts.find((part) => part.type === "year")?.value ?? "1970"}-${
      parts.find((part) => part.type === "month")?.value ?? "01"
    }-${parts.find((part) => part.type === "day")?.value ?? "01"}`,
  }
}

// Flexi Time — check-in allowed within this window with no late penalty; expected end = check-in + N hours.
export const FLEXI_WINDOW_START = "12:00"
export const FLEXI_WINDOW_END = "15:00"
export const FLEXI_WORK_HOURS = 9

/** Format a Date as "HH:mm" in the given timezone. */
function formatHmInZone(date: Date, timeZone = ATTENDANCE_TIMEZONE) {
  const p = getDateTimeParts(date, timeZone)
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
}

function getWeekdayInTimezone(date: Date, timeZone = ATTENDANCE_TIMEZONE) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date)

  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  }

  return map[weekday] ?? 1
}

function parseTimeString(value: string | null | undefined, fallback: string) {
  const candidate = value?.trim() || fallback
  const match = candidate.match(/^(\d{1,2}):(\d{2})$/)

  if (!match) {
    const [defaultHour, defaultMinute] = fallback.split(":").map(Number)
    return { hour: defaultHour, minute: defaultMinute, normalized: fallback }
  }

  const hour = Math.min(23, Math.max(0, Number(match[1])))
  const minute = Math.min(59, Math.max(0, Number(match[2])))
  return {
    hour,
    minute,
    normalized: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  }
}

function getTimeZoneOffsetMinutes(date: Date, timeZone = ATTENDANCE_TIMEZONE) {
  const parts = getDateTimeParts(date, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return (asUtc - date.getTime()) / 60_000
}

function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone = ATTENDANCE_TIMEZONE
) {
  const initialUtc = new Date(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second ?? 0)
  )
  const offsetMinutes = getTimeZoneOffsetMinutes(initialUtc, timeZone)
  return new Date(initialUtc.getTime() - offsetMinutes * 60_000)
}

/** Minutes a check-in is later than the shift start ("HH:MM") on its attendance date. 0 if on-time/early. */
export function minutesLateAgainstShift(checkInAt: Date, attendanceDate: Date, shiftStartTime: string, timeZone = ATTENDANCE_TIMEZONE): number {
  const m = /^(\d{2}):(\d{2})$/.exec(shiftStartTime?.trim() ?? "")
  if (!m) return 0
  const parts = getDateParts(attendanceDate, timeZone)
  const shiftStartAt = zonedDateTimeToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: Number(m[1]), minute: Number(m[2]) }, timeZone)
  return differenceInMinutes(checkInAt, shiftStartAt)
}

function normalizeWorkdays(workdays: number[] | null | undefined) {
  const source = Array.isArray(workdays) && workdays.length > 0 ? workdays : DEFAULT_WORKDAYS
  return Array.from(new Set(source.filter((value) => Number.isInteger(value) && value >= 1 && value <= 7))).sort(
    (left, right) => left - right
  )
}

function differenceInMinutes(later: Date, earlier: Date) {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 60_000))
}

function buildShiftWindow(
  referenceDate: Date,
  office: OfficeLocationLike,
  options?: {
    shiftStartTime?: string | null
    shiftEndTime?: string | null
    shiftSource?: "OFFICE" | "TEAM" | "USER"
    effectiveTeamId?: string | null
    effectiveTeamName?: string | null
  }
) {
  const timeZone = safeAttendanceTimezone(office.timezone)
  const dateParts = getDateParts(referenceDate, timeZone)
  const shiftStart = parseTimeString(options?.shiftStartTime ?? office.shiftStartTime, "09:00")
  const shiftEnd = parseTimeString(options?.shiftEndTime ?? office.shiftEndTime, "18:00")

  const shiftStartAt = zonedDateTimeToUtc(
    {
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      hour: shiftStart.hour,
      minute: shiftStart.minute,
    },
    timeZone
  )

  let shiftEndAt = zonedDateTimeToUtc(
    {
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      hour: shiftEnd.hour,
      minute: shiftEnd.minute,
    },
    timeZone
  )

  if (shiftEndAt.getTime() <= shiftStartAt.getTime()) {
    shiftEndAt = new Date(shiftEndAt.getTime() + 24 * 60 * 60 * 1000)
  }

  return {
    timeZone,
    workdays: normalizeWorkdays(office.workdays),
    shiftStartTime: shiftStart.normalized,
    shiftEndTime: shiftEnd.normalized,
    lateGraceMinutes: Math.max(0, office.lateGraceMinutes ?? 0),
    earlyLeaveGraceMinutes: Math.max(0, office.earlyLeaveGraceMinutes ?? 0),
    shiftStartAt,
    shiftEndAt,
    effectiveShiftSource: options?.shiftSource ?? "OFFICE",
    effectiveTeamId: options?.effectiveTeamId ?? null,
    effectiveTeamName: options?.effectiveTeamName ?? null,
  }
}

export async function getPrimaryAttendanceTeam(userId: string, workspaceId: string) {
  return prisma.teamMember.findFirst({
    where: {
      userId,
      isAttendancePrimary: true,
      attendancePrimaryWorkspaceId: workspaceId,
      team: {
        workspaceId,
      },
    },
    select: {
      teamId: true,
      team: {
        select: {
          id: true,
          name: true,
          attendanceShiftOverrideEnabled: true,
          attendanceShiftStartTime: true,
          attendanceShiftEndTime: true,
        },
      },
    },
  })
}

/** Whether this member is geofence-exempt (Custom/Mobile attendance — check in/out anywhere). */
export async function getMemberNoGeofence(userId: string, workspaceId: string): Promise<boolean> {
  const m = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { noGeofenceMode: true },
  })
  return m?.noGeofenceMode ?? false
}

/** Per-person attendance shift override (WorkspaceMember). Active only when BOTH times are set. */
export async function getUserAttendanceShift(userId: string, workspaceId: string) {
  return prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { attendanceShiftStartTime: true, attendanceShiftEndTime: true, attendanceShiftByDay: true, flexiTimeEnabled: true },
  })
}

const SHIFT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Pull a valid per-weekday shift override ({start,end} in HH:mm) from the JSON map for an ISO weekday (1=Mon..7=Sun). */
export function pickDayShift(shiftByDay: unknown, weekday: number): { start: string; end: string } | null {
  if (!shiftByDay || typeof shiftByDay !== "object") return null
  const entry = (shiftByDay as Record<string, unknown>)[String(weekday)]
  if (!entry || typeof entry !== "object") return null
  const start = (entry as Record<string, unknown>).start
  const end = (entry as Record<string, unknown>).end
  if (typeof start === "string" && typeof end === "string" && SHIFT_TIME_RE.test(start) && SHIFT_TIME_RE.test(end) && start !== end) {
    return { start, end }
  }
  return null
}

export async function resolveEffectiveAttendanceShift(args: {
  userId: string
  workspaceId: string
  office: OfficeLocationLike
  /** Attendance date — its weekday (in the attendance timezone) selects any per-day override. Defaults to now. */
  date?: Date
}) {
  // Precedence: FLEXI (per-member) > USER per-weekday override > USER default > TEAM override > OFFICE default.
  const member = await getUserAttendanceShift(args.userId, args.workspaceId)
  if (member) {
    // Flexi Time beats every fixed shift: the "window" (12:00–15:00) is the on-time check-in range; the
    // actual expected end is computed dynamically (check-in + 9h) in deriveAttendanceMetrics.
    if (member.flexiTimeEnabled) {
      return {
        source: "USER" as const,
        teamId: null,
        teamName: null,
        shiftStartTime: FLEXI_WINDOW_START,
        shiftEndTime: FLEXI_WINDOW_END,
        flexi: true,
      }
    }
    // Derive the weekday in the OFFICE's timezone — the same zone the shift window & workday check use —
    // so the per-day override selection can't disagree with the late/early penalty math.
    const weekday = getWeekdayInTimezone(args.date ?? new Date(), safeAttendanceTimezone(args.office.timezone))
    const dayOverride = pickDayShift(member.attendanceShiftByDay, weekday)
    if (dayOverride) {
      return {
        source: "USER" as const,
        teamId: null,
        teamName: null,
        shiftStartTime: dayOverride.start,
        shiftEndTime: dayOverride.end,
        flexi: false,
      }
    }
    if (member.attendanceShiftStartTime && member.attendanceShiftEndTime) {
      return {
        source: "USER" as const,
        teamId: null,
        teamName: null,
        shiftStartTime: member.attendanceShiftStartTime,
        shiftEndTime: member.attendanceShiftEndTime,
        flexi: false,
      }
    }
  }

  const primary = await getPrimaryAttendanceTeam(args.userId, args.workspaceId)
  const team = primary?.team

  if (
    team?.attendanceShiftOverrideEnabled &&
    team.attendanceShiftStartTime &&
    team.attendanceShiftEndTime
  ) {
    return {
      source: "TEAM" as const,
      teamId: team.id,
      teamName: team.name,
      shiftStartTime: team.attendanceShiftStartTime,
      shiftEndTime: team.attendanceShiftEndTime,
      flexi: false,
    }
  }

  return {
    source: "OFFICE" as const,
    teamId: null,
    teamName: null,
    shiftStartTime: args.office.shiftStartTime?.trim() || "09:00",
    shiftEndTime: args.office.shiftEndTime?.trim() || "18:00",
    flexi: false,
  }
}

/**
 * Overnight-aware shift END datetime for a given attendance date. When the shift end is <= the start
 * (e.g. a 21:00→03:00 night shift) it rolls to the next calendar day. Used to decide when a
 * "forgot to check out" penalty may FAIRLY apply — a night-shift worker who is still on shift (or just
 * finished) must not be flagged as a no-checkout by the 02:00 nightly cron.
 */
export function resolveShiftEndAt(
  date: Date,
  office: OfficeLocationLike,
  shift: { shiftStartTime?: string | null; shiftEndTime?: string | null },
): Date {
  return buildShiftWindow(date, office, {
    shiftStartTime: shift.shiftStartTime,
    shiftEndTime: shift.shiftEndTime,
  }).shiftEndAt
}

/** Full shift window (start + overnight-aware end) for a date — used when synthesizing a corrected
 *  "hadir on-time" record so its times line up with the member's actual shift. */
export function resolveShiftWindowAt(
  date: Date,
  office: OfficeLocationLike,
  shift: { shiftStartTime?: string | null; shiftEndTime?: string | null },
): { shiftStartAt: Date; shiftEndAt: Date } {
  const w = buildShiftWindow(date, office, {
    shiftStartTime: shift.shiftStartTime,
    shiftEndTime: shift.shiftEndTime,
  })
  return { shiftStartAt: w.shiftStartAt, shiftEndAt: w.shiftEndAt }
}

/**
 * The "attendance day" (midnight-UTC anchor) that `date` falls on in the given timezone. Defaults to
 * the app/workspace timezone (ATTENDANCE_TIMEZONE). When you already know the specific office an action
 * belongs to AND that office may be in a different timezone, pass `safeAttendanceTimezone(office.timezone)`
 * so the recorded day matches the office's shift-window day. Callers that only know the workspace (e.g.
 * check-in before the geofenced office is resolved) intentionally use the default — a workspace can host
 * several offices, so there is no single office tz to anchor on at that point.
 */
export function getAttendanceDate(date = new Date(), timeZone = ATTENDANCE_TIMEZONE) {
  const { key } = getDateParts(date, timeZone)
  return new Date(`${key}T00:00:00.000Z`)
}

export function formatAttendanceDateKey(date = new Date(), timeZone = ATTENDANCE_TIMEZONE) {
  return getDateParts(date, timeZone).key
}

export function attendanceMonthRange(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  return { start, end }
}

// Company payroll cut-off: the attendance period closes on the 27th. The period labeled by `monthKey`
// runs from the 28th of the PREVIOUS month through the 27th of monthKey's month.
// e.g. "2026-06" → 2026-05-28 .. 2026-06-27. Used for the attendance recap/board/export AND the
// DAY_OFF quota (since 2026-06-30). RED_DATE quota stays on the calendar month (attendanceMonthRange).
export const ATTENDANCE_CUTOFF_DAY = 27
export function attendancePeriodRange(monthKey: string, cutoffDay = ATTENDANCE_CUTOFF_DAY) {
  const [year, month] = monthKey.split("-").map(Number)
  // end = cutoff day of monthKey's month (00:00 UTC, matching how attendanceDate is stored)
  const end = new Date(Date.UTC(year, month - 1, cutoffDay))
  // start = the day after the cut-off, in the previous month
  const start = new Date(Date.UTC(year, month - 2, cutoffDay + 1))
  return { start, end }
}

// Which attendance PERIOD ("YYYY-MM", cut-off 28→27) a given attendance date-key ("YYYY-MM-DD") falls
// in: a day ON/AFTER the 28th belongs to the NEXT month's period. Defaults to today's attendance date.
// Cut-off-aware counterpart of slicing "YYYY-MM" off a calendar date.
export function attendancePeriodKey(dateKey: string = formatAttendanceDateKey(), cutoffDay = ATTENDANCE_CUTOFF_DAY): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  let y = year, m = month
  if (day > cutoffDay) { m += 1; if (m > 12) { m = 1; y += 1 } }
  return `${y}-${String(m).padStart(2, "0")}`
}

export function parseDateOnlyToUtc(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

export function enumerateAttendanceDates(start: Date, end: Date) {
  const dates: Date[] = []
  const cursor = new Date(start)
  while (cursor.getTime() <= end.getTime()) {
    dates.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export function startOfAttendanceMonth(date: Date, timeZone = ATTENDANCE_TIMEZONE) {
  const { year, month } = getDateParts(date, timeZone)
  return new Date(Date.UTC(year, month - 1, 1))
}

export function endOfAttendanceMonth(date: Date, timeZone = ATTENDANCE_TIMEZONE) {
  const { year, month } = getDateParts(date, timeZone)
  return new Date(Date.UTC(year, month, 0))
}

export function isWorkdayForAttendanceDate(date: Date, office: OfficeLocationLike) {
  const policy = buildShiftWindow(date, office)
  const weekday = getWeekdayInTimezone(date, policy.timeZone)
  return policy.workdays.includes(weekday)
}

export function isAttendanceSilentCorrectionAdmin(email: string | null | undefined) {
  if (!email) return false

  const configured = (
    process.env.ATTENDANCE_SILENT_CORRECTION_ADMINS ||
    DEFAULT_SILENT_CORRECTION_ADMINS.join(",")
  )
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  return configured.includes(email.trim().toLowerCase())
}

export function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadius = 6371000
  const deltaLat = toRadians(lat2 - lat1)
  const deltaLng = toRadians(lng2 - lng1)
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

export function resolveNearestOffice(offices: OfficeLocationLike[], lat: number, lng: number) {
  if (offices.length === 0) return null

  const ranked = offices.map((office) => ({
    office,
    distanceMeters: haversineDistanceMeters(lat, lng, office.latitude, office.longitude),
  }))

  ranked.sort((left, right) => left.distanceMeters - right.distanceMeters)
  return ranked[0] ?? null
}

export function deriveAttendanceStatus(
  checkInAt: Date | null,
  checkOutAt: Date | null
): "CHECKED_IN" | "COMPLETED" | "INCOMPLETE" {
  if (checkInAt && checkOutAt) return "COMPLETED"
  if (checkInAt) return "CHECKED_IN"
  return "INCOMPLETE"
}

export function deriveAttendanceMetrics(input: {
  attendanceDate: Date
  checkInAt: Date | null
  checkOutAt: Date | null
  office: OfficeLocationLike
  effectiveShift?: {
    source: "OFFICE" | "TEAM" | "USER"
    teamId: string | null
    teamName: string | null
    shiftStartTime: string
    shiftEndTime: string
    flexi?: boolean
  } | null
  treatAsNonWorkday?: boolean // tanggal merah → no late/early penalty for the day
}): AttendanceDerivedMetrics {
  // Anchor the shift window & workday weekday on the record's official attendanceDate — the SAME day
  // whose weekday selected any per-day shift override — so selection, window, and workday all agree.
  // (For normal/overnight check-ins attendanceDate already == checkInAt's calendar day; this only
  // matters for admin corrections where checkInAt is moved to a different day.)
  const shiftReference = input.attendanceDate
  const policy = buildShiftWindow(shiftReference, input.office, {
    shiftStartTime: input.effectiveShift?.shiftStartTime,
    shiftEndTime: input.effectiveShift?.shiftEndTime,
    shiftSource: input.effectiveShift?.source,
    effectiveTeamId: input.effectiveShift?.teamId,
    effectiveTeamName: input.effectiveShift?.teamName,
  })
  const weekday = getWeekdayInTimezone(shiftReference, policy.timeZone)
  const isWorkday = input.treatAsNonWorkday ? false : policy.workdays.includes(weekday)

  let checkInStatus: AttendanceDerivedMetrics["checkInStatus"] = null
  let checkOutStatus: AttendanceDerivedMetrics["checkOutStatus"] = null
  let lateMinutes = 0
  let earlyLeaveMinutes = 0
  let workedMinutes = 0

  // ── Flexi Time ──────────────────────────────────────────────────────────────
  // On-time if checked in any time up to the window end (15:00). After that → LATE (vs the window end).
  // Expected end is DYNAMIC: check-in + 9h. Early-leave/overtime measured against that, not a fixed clock.
  if (input.effectiveShift?.flexi && input.checkInAt) {
    const tz = policy.timeZone
    const dp = getDateParts(shiftReference, tz)
    const we = parseTimeString(FLEXI_WINDOW_END, "15:00")
    const windowEndAt = zonedDateTimeToUtc({ year: dp.year, month: dp.month, day: dp.day, hour: we.hour, minute: we.minute }, tz)
    const expectedEndAt = new Date(input.checkInAt.getTime() + FLEXI_WORK_HOURS * 60 * 60 * 1000)

    const lateThresholdAt = new Date(windowEndAt.getTime() + policy.lateGraceMinutes * 60_000)
    checkInStatus = isWorkday && input.checkInAt.getTime() > lateThresholdAt.getTime() ? "LATE" : "ON_TIME"
    lateMinutes = checkInStatus === "LATE" ? differenceInMinutes(input.checkInAt, windowEndAt) : 0

    if (input.checkOutAt) {
      const earlyThresholdAt = new Date(expectedEndAt.getTime() - policy.earlyLeaveGraceMinutes * 60_000)
      if (isWorkday && input.checkOutAt.getTime() < earlyThresholdAt.getTime()) {
        checkOutStatus = "EARLY_LEAVE"
        earlyLeaveMinutes = differenceInMinutes(expectedEndAt, input.checkOutAt)
      } else if (input.checkOutAt.getTime() > expectedEndAt.getTime()) {
        checkOutStatus = "OVERTIME"
      } else {
        checkOutStatus = "ON_TIME"
      }
      workedMinutes = differenceInMinutes(input.checkOutAt, input.checkInAt)
    }

    return {
      checkInStatus,
      checkOutStatus,
      lateMinutes,
      earlyLeaveMinutes,
      workedMinutes,
      timeZone: tz,
      workdays: policy.workdays,
      // Self-describing schedule for display/audit: actual start → computed end (e.g. "13:30" → "22:30").
      shiftStartTime: formatHmInZone(input.checkInAt, tz),
      shiftEndTime: formatHmInZone(expectedEndAt, tz),
      lateGraceMinutes: policy.lateGraceMinutes,
      earlyLeaveGraceMinutes: policy.earlyLeaveGraceMinutes,
      shiftStartAt: input.checkInAt,
      shiftEndAt: expectedEndAt,
      effectiveShiftSource: policy.effectiveShiftSource,
      effectiveTeamId: policy.effectiveTeamId,
      effectiveTeamName: policy.effectiveTeamName,
    }
  }

  if (input.checkInAt) {
    const lateThresholdAt = new Date(policy.shiftStartAt.getTime() + policy.lateGraceMinutes * 60_000)
    const actualLateMinutes = differenceInMinutes(input.checkInAt, policy.shiftStartAt)
    checkInStatus = isWorkday && input.checkInAt.getTime() > lateThresholdAt.getTime() ? "LATE" : "ON_TIME"
    lateMinutes = checkInStatus === "LATE" ? actualLateMinutes : 0
  }

  if (input.checkOutAt) {
    const earlyThresholdAt = new Date(policy.shiftEndAt.getTime() - policy.earlyLeaveGraceMinutes * 60_000)
    if (isWorkday && input.checkOutAt.getTime() < earlyThresholdAt.getTime()) {
      checkOutStatus = "EARLY_LEAVE"
      earlyLeaveMinutes = differenceInMinutes(policy.shiftEndAt, input.checkOutAt)
    } else if (input.checkOutAt.getTime() > policy.shiftEndAt.getTime()) {
      checkOutStatus = "OVERTIME"
    } else {
      checkOutStatus = "ON_TIME"
    }
  }

  if (input.checkInAt && input.checkOutAt) {
    workedMinutes = differenceInMinutes(input.checkOutAt, input.checkInAt)
  }

  return {
    checkInStatus,
    checkOutStatus,
    lateMinutes,
    earlyLeaveMinutes,
    workedMinutes,
    timeZone: policy.timeZone,
    workdays: policy.workdays,
    shiftStartTime: policy.shiftStartTime,
    shiftEndTime: policy.shiftEndTime,
    lateGraceMinutes: policy.lateGraceMinutes,
    earlyLeaveGraceMinutes: policy.earlyLeaveGraceMinutes,
    shiftStartAt: policy.shiftStartAt,
    shiftEndAt: policy.shiftEndAt,
    effectiveShiftSource: policy.effectiveShiftSource,
    effectiveTeamId: policy.effectiveTeamId,
    effectiveTeamName: policy.effectiveTeamName,
  }
}

export function buildAttendanceDerivedFields(input: {
  attendanceDate: Date
  checkInAt: Date | null
  checkOutAt: Date | null
  office: OfficeLocationLike
  effectiveShift?: {
    source: "OFFICE" | "TEAM" | "USER"
    teamId: string | null
    teamName: string | null
    shiftStartTime: string
    shiftEndTime: string
    flexi?: boolean
  } | null
  treatAsNonWorkday?: boolean // tanggal merah → no late/early penalty for the day
}) {
  const metrics = deriveAttendanceMetrics(input)
  return {
    status: deriveAttendanceStatus(input.checkInAt, input.checkOutAt),
    attendanceFlexi: !!input.effectiveShift?.flexi,
    effectiveShiftSource: metrics.effectiveShiftSource,
    effectiveTeamId: metrics.effectiveTeamId,
    effectiveTeamName: metrics.effectiveTeamName,
    effectiveShiftStartTime: metrics.shiftStartTime,
    effectiveShiftEndTime: metrics.shiftEndTime,
    checkInStatus: metrics.checkInStatus,
    checkOutStatus: metrics.checkOutStatus,
    lateMinutes: metrics.lateMinutes,
    earlyLeaveMinutes: metrics.earlyLeaveMinutes,
    workedMinutes: metrics.workedMinutes,
  }
}

function isDerivedMetricsMissing(record: AttendanceRecordInput) {
  return (
    record.checkInStatus === null ||
    record.checkInStatus === undefined ||
    (record.checkOutAt !== null && record.checkOutAt !== undefined && (record.checkOutStatus === null || record.checkOutStatus === undefined))
  )
}

export function getAttendanceRecordMetrics(record: AttendanceRecordInput) {
  const derived = deriveAttendanceMetrics({
    attendanceDate: record.attendanceDate,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    office: record.officeLocation,
    effectiveShift: {
      source: record.effectiveShiftSource ?? "OFFICE",
      teamId: record.effectiveTeamId ?? null,
      teamName: record.effectiveTeamName ?? null,
      shiftStartTime:
        record.effectiveShiftStartTime ??
        parseTimeString(record.officeLocation.shiftStartTime, "09:00").normalized,
      shiftEndTime:
        record.effectiveShiftEndTime ??
        parseTimeString(record.officeLocation.shiftEndTime, "18:00").normalized,
      flexi: record.attendanceFlexi ?? false,
    },
  })

  const useDerived = isDerivedMetricsMissing(record)
  return {
    ...derived,
    checkInStatus: useDerived ? derived.checkInStatus : record.checkInStatus ?? derived.checkInStatus,
    checkOutStatus: useDerived ? derived.checkOutStatus : record.checkOutStatus ?? derived.checkOutStatus,
    lateMinutes: useDerived ? derived.lateMinutes : Math.max(0, record.lateMinutes ?? derived.lateMinutes),
    earlyLeaveMinutes: useDerived
      ? derived.earlyLeaveMinutes
      : Math.max(0, record.earlyLeaveMinutes ?? derived.earlyLeaveMinutes),
    workedMinutes: useDerived ? derived.workedMinutes : Math.max(0, record.workedMinutes ?? derived.workedMinutes),
  }
}

export function isAttendanceCorrected(record: Pick<AttendanceRecordInput, "correctedAt" | "correctionReason" | "correctedBy">) {
  return Boolean(record.correctedAt || record.correctionReason || record.correctedBy)
}

export async function getAttendanceWorkspaceContext(userId: string) {
  const [user, workspaceMember] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
      },
    }),
    prisma.workspaceMember.findFirst({
      where: { userId },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    }),
  ])

  const workspace = workspaceMember?.workspace ?? null
  const workspaceRole = workspaceMember?.role ?? null
  const attendanceRole = workspaceMember?.attendanceRole ?? "NONE" // vestigial — role retired
  const isSystemAdmin = user?.role === "ADMIN"
  // Full workspace attendance management (every staff) stays BoD / One-Above-All / system-admin.
  const canManageAttendance = Boolean(isSystemAdmin || workspaceRole === "BOD" || workspaceRole === "ONE_ABOVE_ALL")
  // A MANAGER who LEADS one or more teams gets TEAM-SCOPED attendance powers: view + approve only the
  // attendance of members of the team(s) they lead. (Set someone as team Lead in Crew Hub / Teams.)
  let teamLeadTeamIds: string[] = []
  if (!canManageAttendance && workspaceRole === "MANAGER" && workspace?.id) {
    const leads = await prisma.teamMember.findMany({
      where: { userId, role: "LEAD", team: { workspaceId: workspace.id } },
      select: { teamId: true },
    })
    teamLeadTeamIds = leads.map((l) => l.teamId)
  }
  const canReviewAttendanceRequests = canManageAttendance || teamLeadTeamIds.length > 0

  return {
    user,
    workspace,
    workspaceMember,
    workspaceRole,
    attendanceRole,
    isAttendanceSupervisor: false,
    canManageAttendance,
    teamLeadTeamIds,
    canReviewAttendanceRequests,
  }
}

export async function markPreviousOpenAttendanceIncomplete(userId: string, workspaceId: string, attendanceDate: Date) {
  await prisma.attendanceRecord.updateMany({
    where: {
      userId,
      workspaceId,
      attendanceDate: { lt: attendanceDate },
      status: "CHECKED_IN",
    },
    data: {
      status: "INCOMPLETE",
    },
  })
}

export function serializeAttendanceRecord(record: AttendanceRecordWithRelations) {
  const metrics = getAttendanceRecordMetrics(record)
  const isCorrected = isAttendanceCorrected(record)

  return {
    id: record.id,
    attendanceDate: record.attendanceDate.toISOString(),
    checkInAt: record.checkInAt?.toISOString() ?? null,
    checkOutAt: record.checkOutAt?.toISOString() ?? null,
    checkInStatus: metrics.checkInStatus,
    checkOutStatus: metrics.checkOutStatus,
    lateMinutes: metrics.lateMinutes,
    earlyLeaveMinutes: metrics.earlyLeaveMinutes,
    workedMinutes: metrics.workedMinutes,
    shiftStartAt: metrics.shiftStartAt?.toISOString() ?? null,
    shiftEndAt: metrics.shiftEndAt?.toISOString() ?? null,
    effectiveShiftSource: record.effectiveShiftSource ?? metrics.effectiveShiftSource,
    effectiveTeamId: record.effectiveTeamId ?? metrics.effectiveTeamId,
    effectiveTeamName: record.effectiveTeamName ?? metrics.effectiveTeamName,
    effectiveShiftStartTime:
      record.effectiveShiftStartTime ?? metrics.shiftStartTime,
    effectiveShiftEndTime:
      record.effectiveShiftEndTime ?? metrics.shiftEndTime,
    checkInLat: record.checkInLat,
    checkInLng: record.checkInLng,
    checkOutLat: record.checkOutLat,
    checkOutLng: record.checkOutLng,
    checkInAddress: record.checkInAddress,
    checkOutAddress: record.checkOutAddress,
    checkInPhotoUrl: record.checkInPhotoUrl,
    checkOutPhotoUrl: record.checkOutPhotoUrl,
    checkInDistanceMeters: record.checkInDistanceMeters,
    checkOutDistanceMeters: record.checkOutDistanceMeters,
    checkOutOffsite: record.checkOutOffsite ?? false,
    checkOutApproval: record.checkOutApproval ?? null,
    checkOutReason: record.checkOutReason ?? null,
    checkOutReflection: record.checkOutReflection ?? null,
    checkOutReflectionAt: record.checkOutReflectionAt?.toISOString() ?? null,
    notes: record.notes,
    status: record.status,
    correctedAt: record.correctedAt?.toISOString() ?? null,
    correctionReason: record.correctionReason,
    isCorrected,
    officeLocation: {
      id: record.officeLocation.id,
      name: record.officeLocation.name,
      address: record.officeLocation.address ?? null,
      latitude: record.officeLocation.latitude,
      longitude: record.officeLocation.longitude,
      radiusMeters: record.officeLocation.radiusMeters,
      timezone: safeAttendanceTimezone(record.officeLocation.timezone),
      workdays: normalizeWorkdays(record.officeLocation.workdays),
      shiftStartTime: parseTimeString(record.officeLocation.shiftStartTime, "09:00").normalized,
      shiftEndTime: parseTimeString(record.officeLocation.shiftEndTime, "18:00").normalized,
      lateGraceMinutes: Math.max(0, record.officeLocation.lateGraceMinutes ?? 0),
      earlyLeaveGraceMinutes: Math.max(0, record.officeLocation.earlyLeaveGraceMinutes ?? 0),
      isActive: record.officeLocation.isActive,
    },
    user: {
      id: record.user.id,
      name: record.user.name,
      email: record.user.email,
      avatar: record.user.avatar,
    },
    correctedBy: record.correctedBy
      ? {
          id: record.correctedBy.id,
          name: record.correctedBy.name,
          email: record.correctedBy.email,
        }
      : null,
  }
}

export function mapRequestTypeToAttendanceDayType(type: AttendanceRequestWithRelations["type"]): AttendanceDayType {
  switch (type) {
    case "LEAVE":
      return "LEAVE_APPROVED"
    case "SICK":
      return "SICK_APPROVED"
    case "PERMIT":
      return "PERMIT_APPROVED"
    case "DAY_OFF":
      return "DAY_OFF_APPROVED"
    case "RED_DATE":
      return "DAY_OFF_APPROVED" // tanggal merah covers the day like a day-off
  }
}

export function serializeAttendanceRequest(request: AttendanceRequestWithRelations) {
  return {
    id: request.id,
    startDate: request.startDate.toISOString(),
    endDate: request.endDate.toISOString(),
    type: request.type,
    status: request.status,
    reason: request.reason,
    reviewNote: request.reviewNote,
    approvalSource: request.approvalSource,
    supportingDocumentUrl: request.supportingDocumentUrl,
    supportingDocumentName: request.supportingDocumentName,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    workspaceId: request.workspaceId,
    userId: request.userId,
    teamId: request.teamId,
    attendanceDayType: request.status === "APPROVED" ? mapRequestTypeToAttendanceDayType(request.type) : null,
    user: request.user,
    reviewedBy: request.reviewedBy,
    team: request.team,
  }
}

function escapeCsvValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return ""
  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

export function attendanceRecordsToCsv(records: AttendanceRecordWithRelations[]) {
  const headers = [
    "date",
    "user_name",
    "user_email",
    "office_name",
    "effective_shift_source",
    "effective_team_name",
    "effective_shift_start_time",
    "effective_shift_end_time",
    "check_in_at",
    "check_out_at",
    "worked_minutes",
    "attendance_status",
    "check_in_status",
    "check_out_status",
    "late_minutes",
    "early_leave_minutes",
    "check_in_address",
    "check_out_address",
    "check_in_distance_meters",
    "check_out_distance_meters",
    "is_corrected",
    "correction_reason",
    "notes",
  ]

  const rows = records.map((record) => {
    const metrics = getAttendanceRecordMetrics(record)
    return [
      formatAttendanceDateKey(record.attendanceDate, safeAttendanceTimezone(record.officeLocation.timezone)),
      record.user.name,
      record.user.email,
      record.officeLocation.name,
      record.effectiveShiftSource ?? metrics.effectiveShiftSource,
      record.effectiveTeamName ?? metrics.effectiveTeamName ?? "",
      record.effectiveShiftStartTime ?? metrics.shiftStartTime,
      record.effectiveShiftEndTime ?? metrics.shiftEndTime,
      record.checkInAt?.toISOString() ?? "",
      record.checkOutAt?.toISOString() ?? "",
      metrics.workedMinutes,
      record.status,
      metrics.checkInStatus ?? "",
      metrics.checkOutStatus ?? "",
      metrics.lateMinutes,
      metrics.earlyLeaveMinutes,
      record.checkInAddress ?? "",
      record.checkOutAddress ?? "",
      record.checkInDistanceMeters?.toFixed(2) ?? "",
      record.checkOutDistanceMeters?.toFixed(2) ?? "",
      isAttendanceCorrected(record) ? "yes" : "no",
      record.correctionReason ?? "",
      record.notes ?? "",
    ]
  })

  return [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\n")
}
