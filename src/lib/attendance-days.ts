import prisma from "@/lib/prisma"
import {
  AttendanceDayType,
  enumerateAttendanceDates,
  formatAttendanceDateKey,
  getAttendanceRecordMetrics,
  isRestDayForMember,
  isWorkdayForAttendanceDate,
  mapRequestTypeToAttendanceDayType,
} from "@/lib/attendance"
import { getOutageDateKeysForRange, isAutoDeduction } from "@/lib/attendance-absence"
import { getHolidayKeys } from "@/lib/holidays"

/**
 * What each (person, day) WAS, by the same rules the attendance history board and the Sheets export
 * use (GET /api/attendance/history). Reports per crew count these days; the board paints them. If
 * the two ever disagree, a manager sees "3 absent" in Reports and two red cells on the board — so
 * this mirrors that route step by step, reusing its helpers, and the order below is the precedence:
 *
 *   1. an attendance record on the day          → PRESENT (late/early/worked from getAttendanceRecordMetrics,
 *                                                  exactly what serializeAttendanceRecord sends the board)
 *   2. an APPROVED request covering the day      → its day type, REPLACING the record (the board does too).
 *      The cron's auto-deduction DAY_OFF is a penalty row, not a day off (isAutoDeduction) → skipped.
 *   3. neither, on a past workday of the first active office, on/after the person's first day
 *      (joinedAt / user.createdAt, or an earlier first check-in), not their rest day, not a public
 *      holiday, not a NEXUS-down day                                                   → ABSENT.
 *   Anything else (future, today, holiday, rest day, before they joined) is simply not a day here.
 *
 * Keep this in step with src/app/api/attendance/history/route.ts. The route is deliberately not
 * rewritten onto this function yet: it is the payroll export, and moving it is its own change.
 */

export type ClassifiedAttendanceDay = {
  dateKey: string
  dayType: AttendanceDayType
  source: "ATTENDANCE" | "REQUEST" | "ABSENT"
  requestType: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF" | "RED_DATE" | null
  lateMinutes: number
  earlyLeaveMinutes: number
  workedMinutes: number
  checkedOut: boolean
  /** Checked out with a non-empty daily reflection. */
  hasReflection: boolean
}

/**
 * Classify every day in [start, end] (UTC-midnight attendance dates, inclusive) for `userIds` in one
 * workspace. Set-based: a fixed handful of queries whatever the number of people.
 * Returns userId → days (only days that are something; see above). Unknown users map to [].
 */
export async function classifyAttendanceDays(opts: {
  workspaceId: string
  userIds: string[]
  start: Date
  end: Date
}): Promise<Map<string, ClassifiedAttendanceDay[]>> {
  const { workspaceId, start, end } = opts
  const userIds = [...new Set(opts.userIds)]
  const out = new Map<string, ClassifiedAttendanceDay[]>(userIds.map((id) => [id, []]))
  if (userIds.length === 0) return out

  const [records, approvedRequests, activeOffices, members, holidayKeys, outageKeys, firstRecords] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { workspaceId, userId: { in: userIds }, attendanceDate: { gte: start, lte: end } },
      include: { officeLocation: true },
    }),
    prisma.attendanceRequest.findMany({
      where: { workspaceId, userId: { in: userIds }, status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } },
      select: { userId: true, type: true, startDate: true, endDate: true, reason: true, reviewedById: true, approvalSource: true },
    }),
    prisma.officeLocation.findMany({ where: { workspaceId, isActive: true }, orderBy: [{ createdAt: "asc" }] }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: userIds } },
      select: { userId: true, joinedAt: true, restDays: true, user: { select: { createdAt: true } } },
    }),
    getHolidayKeys(workspaceId, start, end),
    getOutageDateKeysForRange(start, end),
    prisma.attendanceRecord.groupBy({ by: ["userId"], where: { workspaceId, userId: { in: userIds } }, _min: { attendanceDate: true } }),
  ])

  const days = new Map<string, ClassifiedAttendanceDay>() // `${userId}:${dateKey}`

  // 1. records
  for (const record of records) {
    const metrics = getAttendanceRecordMetrics(record)
    const dateKey = record.attendanceDate.toISOString().slice(0, 10)
    const reflection = (record.checkOutReflection ?? "").trim()
    days.set(`${record.userId}:${dateKey}`, {
      dateKey,
      dayType: "PRESENT",
      source: "ATTENDANCE",
      requestType: null,
      lateMinutes: metrics.lateMinutes ?? 0,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes ?? 0,
      workedMinutes: metrics.workedMinutes ?? 0,
      checkedOut: Boolean(record.checkOutAt),
      hasReflection: Boolean(record.checkOutAt) && reflection.length > 0,
    })
  }

  // 2. approved requests replace the day
  for (const request of approvedRequests) {
    if (isAutoDeduction(request)) continue
    const dayType = mapRequestTypeToAttendanceDayType(request.type)
    for (const date of enumerateAttendanceDates(request.startDate, request.endDate)) {
      if (date.getTime() < start.getTime() || date.getTime() > end.getTime()) continue
      const dateKey = date.toISOString().slice(0, 10)
      days.set(`${request.userId}:${dateKey}`, {
        dateKey,
        dayType,
        source: "REQUEST",
        requestType: request.type,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 0,
        checkedOut: false,
        hasReflection: false,
      })
    }
  }

  // 3. absences — only where the board would paint one
  const fallbackOffice = activeOffices[0] ?? null
  if (fallbackOffice) {
    const todayKey = formatAttendanceDateKey()
    const firstRecordKey = new Map(
      firstRecords.map((r) => [r.userId, r._min.attendanceDate ? formatAttendanceDateKey(r._min.attendanceDate) : null] as const),
    )
    const allDates = enumerateAttendanceDates(start, end)
    for (const member of members) {
      const join = formatAttendanceDateKey(member.joinedAt ?? member.user.createdAt ?? new Date(0))
      const first = firstRecordKey.get(member.userId) ?? null
      const startKey = first && first < join ? first : join
      for (const date of allDates) {
        if (!isWorkdayForAttendanceDate(date, fallbackOffice)) continue
        if (formatAttendanceDateKey(date) < startKey) continue
        if (isRestDayForMember(date, member.restDays, fallbackOffice.timezone)) continue
        const dateKey = date.toISOString().slice(0, 10)
        if (dateKey >= todayKey || holidayKeys.has(dateKey) || outageKeys.has(dateKey)) continue
        const key = `${member.userId}:${dateKey}`
        if (days.has(key)) continue
        days.set(key, {
          dateKey,
          dayType: "ABSENT",
          source: "ABSENT",
          requestType: null,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          workedMinutes: 0,
          checkedOut: false,
          hasReflection: false,
        })
      }
    }
  }

  for (const [key, day] of days) {
    const userId = key.slice(0, key.length - day.dateKey.length - 1)
    out.get(userId)?.push(day)
  }
  for (const list of out.values()) list.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  return out
}
