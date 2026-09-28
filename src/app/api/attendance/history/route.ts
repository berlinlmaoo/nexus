export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { AttendanceDayType, attendancePeriodRange, enumerateAttendanceDates, formatAttendanceDateKey, getAttendanceWorkspaceContext, isWorkdayForAttendanceDate, mapRequestTypeToAttendanceDayType, serializeAttendanceRecord, isRestDayForMember } from "@/lib/attendance"
import { getOutageDateKeysForRange, isAutoDeduction } from "@/lib/attendance-absence"
import { getHolidayKeys } from "@/lib/holidays"
import { attendanceHistoryQuerySchema } from "@/lib/validations"
import { dayOffQuotaByUser } from "@/lib/day-off-usage"
// Letters, colours, summary rows and labels are shared with the live Google Sheet
// (src/lib/attendance-sheet.ts) so the two can never disagree about a day.
import {
  ATTENDANCE_EXPORT_SUMMARY_ROWS,
  ATTENDANCE_EXPORT_TIMEZONE,
  attendanceExportCode,
  attendanceExportFill,
  formatExportDateLabel,
  formatExportPeriod,
  exportWorkingDays,
} from "@/lib/attendance-export-format"

type HistoryRow = ReturnType<typeof serializeAttendanceRecord> & {
  recordKind: "ATTENDANCE" | "REQUEST" | "ABSENT"
  attendanceDayType: AttendanceDayType
  requestType: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF" | "RED_DATE" | null
  requestStatus: "APPROVED" | null
  approvalSource: "ADMIN" | "ATTENDANCE_SUPERVISOR" | "TEAM_HEAD" | "DIRECT_MANAGER" | null
  reviewedAt: string | null
  reviewedBy: {
    id: string
    name: string
    email: string
  } | null
  hasSupportingDocument: boolean
  supportingDocumentUrl: string | null
  supportingDocumentName: string | null
}

function escapeCsvValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return ""
  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

function sortRows(rows: HistoryRow[]) {
  return [...rows].sort((left, right) => {
    const byDate = new Date(right.attendanceDate).getTime() - new Date(left.attendanceDate).getTime()
    if (byDate !== 0) return byDate
    return left.user.name.localeCompare(right.user.name)
  })
}

// PERMIT_APPROVED → "H" and the rest of the mapping live in attendance-export-format.ts.
function getAttendanceExportCode(row: HistoryRow | undefined): string {
  return row ? attendanceExportCode(row.attendanceDayType) : ""
}

function getAttendanceExportFill(code: string) {
  return attendanceExportFill(code)
}

async function buildAttendanceWorkbook({
  rows,
  start,
  end,
  workspaceName,
  quotaByUser,
}: {
  rows: HistoryRow[]
  start: Date
  end: Date
  workspaceName: string
  quotaByUser?: Map<string, number>
}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "NEXUS"
  workbook.created = new Date()

  const users = Array.from(
    rows.reduce((map, row) => {
      map.set(row.user.id, row.user)
      return map
    }, new Map<string, HistoryRow["user"]>())
      .values()
  ).sort((left, right) => left.name.localeCompare(right.name))

  const sheetName = start.toISOString().slice(0, 7).replace("-", "-")
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
  })

  const dates = enumerateAttendanceDates(start, end)
  const userIds = users.map((user) => user.id)
  const rowMap = new Map(rows.map((row) => [`${row.user.id}:${row.attendanceDate.slice(0, 10)}`, row]))
  const lastColumn = Math.max(2, users.length + 1)

  sheet.mergeCells(1, 1, 2, 2)
  const titleCell = sheet.getCell(1, 1)
  titleCell.value = "ABSENSI\nINTERNAL"
  titleCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  titleCell.font = { bold: true, size: 18 }
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD966" } }
  titleCell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  }

  if (lastColumn >= 3) {
    sheet.mergeCells(1, 3, 2, lastColumn)
  }
  const periodCell = sheet.getCell(1, 3)
  periodCell.value = `${workspaceName.toUpperCase()} • ${formatExportPeriod(start, end)}`
  periodCell.alignment = { vertical: "middle", horizontal: "center" }
  periodCell.font = { bold: true, size: 16 }
  periodCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD966" } }
  periodCell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  }

  sheet.getRow(3).height = 8
  sheet.getCell(4, 1).value = "DATE"
  sheet.getCell(4, 1).font = { bold: true, size: 10 }
  sheet.getCell(4, 1).alignment = { horizontal: "center", vertical: "middle" }
  sheet.getCell(4, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD966" } }
  sheet.getCell(4, 1).border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  }

  users.forEach((user, index) => {
    const cell = sheet.getCell(4, index + 2)
    cell.value = user.name.toUpperCase()
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "9DC3E6" } }
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    }
  })

  const summaryCounters = new Map<string, Record<string, number>>()
  for (const userId of userIds) {
    summaryCounters.set(userId, { H: 0, C: 0, S: 0, I: 0, DO: 0, TK: 0, TOTAL: 0 })
  }

  dates.forEach((date, dateIndex) => {
    const rowNumber = 5 + dateIndex
    const row = sheet.getRow(rowNumber)
    const dateCell = row.getCell(1)
    dateCell.value = formatExportDateLabel(date)
    dateCell.font = { size: 10, color: { argb: "FF7F6000" } }
    dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } }
    dateCell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    }

    userIds.forEach((userId, userIndex) => {
      const cell = row.getCell(userIndex + 2)
      const dateKey = date.toISOString().slice(0, 10)
      const code = getAttendanceExportCode(rowMap.get(`${userId}:${dateKey}`))
      cell.value = code || null
      cell.alignment = { horizontal: "center", vertical: "middle" }
      cell.font = { bold: Boolean(code), size: 10, color: { argb: "FF111111" } }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: getAttendanceExportFill(code) } }
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      }

      if (code) {
        const counter = summaryCounters.get(userId)
        if (counter) {
          counter[code] = (counter[code] ?? 0) + 1
        }
      }
    })
  })

  const summaryStartRow = 6 + dates.length
  const summaryRows = ATTENDANCE_EXPORT_SUMMARY_ROWS
  for (const [userId, counter] of summaryCounters) counter.TOTAL = exportWorkingDays(dates.length, quotaByUser?.get(userId))

  summaryRows.forEach((summary, index) => {
    const rowNumber = summaryStartRow + index
    const labelCell = sheet.getCell(rowNumber, 1)
    labelCell.value = summary.label
    labelCell.font = { bold: true, size: 10, color: { argb: "FF3F3F3F" } }
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: summary.fill } }
    labelCell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    }

    userIds.forEach((userId, userIndex) => {
      const cell = sheet.getCell(rowNumber, userIndex + 2)
      cell.value = summaryCounters.get(userId)?.[summary.code] ?? 0
      cell.alignment = { horizontal: "center", vertical: "middle" }
      cell.font = { bold: true, size: 10 }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: summary.fill } }
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      }
    })
  })

  sheet.getColumn(1).width = 28
  users.forEach((_, index) => {
    sheet.getColumn(index + 2).width = 14
  })

  return workbook.xlsx.writeBuffer()
}

/**
 * One person, one row per day. The monthly workbook answers "who was in on the 12th"; this one answers
 * "what happened to Azra this period" — the sheet a BoD hands to the person, or to payroll, when a
 * single record is in dispute.
 */
async function buildPersonWorkbook({
  rows,
  start,
  end,
  workspaceName,
  person,
  dayOffQuota,
}: {
  rows: HistoryRow[]
  start: Date
  end: Date
  workspaceName: string
  person: { name: string; email?: string | null }
  dayOffQuota?: number
}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "NEXUS"
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(start.toISOString().slice(0, 7), { views: [{ state: "frozen", ySplit: 4 }] })

  const thin = { top: { style: "thin" as const }, left: { style: "thin" as const }, bottom: { style: "thin" as const }, right: { style: "thin" as const } }
  const wib = (iso?: string | null) =>
    iso ? new Intl.DateTimeFormat("en-GB", { timeZone: ATTENDANCE_EXPORT_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : ""

  const headers = ["TANGGAL", "STATUS", "CHECK-IN", "CHECK-OUT", "TELAT (MENIT)", "JAM KERJA", "KETERANGAN"]
  sheet.mergeCells(1, 1, 1, headers.length)
  const title = sheet.getCell(1, 1)
  title.value = `ABSENSI · ${person.name.toUpperCase()}`
  title.font = { bold: true, size: 16 }
  title.alignment = { vertical: "middle", horizontal: "center" }
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD966" } }
  title.border = thin
  sheet.getRow(1).height = 26
  sheet.mergeCells(2, 1, 2, headers.length)
  const period = sheet.getCell(2, 1)
  period.value = `${workspaceName.toUpperCase()} • ${formatExportPeriod(start, end)}${person.email ? ` • ${person.email}` : ""}`
  period.font = { bold: true, size: 11 }
  period.alignment = { vertical: "middle", horizontal: "center" }
  period.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD966" } }
  period.border = thin
  sheet.getRow(3).height = 8
  headers.forEach((label, i) => {
    const c = sheet.getCell(4, i + 1)
    c.value = label
    c.font = { bold: true, size: 10 }
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "9DC3E6" } }
    c.border = thin
  })

  const rowMap = new Map(rows.map((row) => [row.attendanceDate.slice(0, 10), row]))
  const counts: Record<string, number> = { H: 0, C: 0, S: 0, DO: 0, TK: 0, TOTAL: 0 }
  let lateTotal = 0
  const dates = enumerateAttendanceDates(start, end)
  dates.forEach((date, i) => {
    const r = sheet.getRow(5 + i)
    const row = rowMap.get(date.toISOString().slice(0, 10))
    const code = getAttendanceExportCode(row)
    const late = row?.lateMinutes ?? 0
    const worked = row?.workedMinutes ?? 0
    const note = row?.isCorrected ? `dikoreksi${row.correctionReason ? `: ${row.correctionReason}` : ""}` : row?.notes ?? ""
    const values: Array<string | number | null> = [
      formatExportDateLabel(date),
      code || null,
      code === "H" ? wib(row?.checkInAt) : "",
      code === "H" ? wib(row?.checkOutAt) : "",
      code === "H" && late > 0 ? late : code === "H" ? 0 : null,
      code === "H" && worked > 0 ? Math.round((worked / 60) * 10) / 10 : null,
      note,
    ]
    values.forEach((v, col) => {
      const c = r.getCell(col + 1)
      c.value = v
      c.border = thin
      c.font = { size: 10, bold: col === 1 }
      c.alignment = { horizontal: col === 0 || col === 6 ? "left" : "center", vertical: "middle" }
      if (col === 0) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } }
      if (col === 1 && code) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: getAttendanceExportFill(code) } }
    })
    if (code) { counts[code] = (counts[code] ?? 0) + 1; lateTotal += code === "H" ? late : 0 }
  })
  counts.TOTAL = exportWorkingDays(dates.length, dayOffQuota)

  const summaryStart = 6 + dates.length
  const summary = [
    { label: "HADIR", value: counts.H, fill: "7CFC00" },
    { label: "CUTI", value: counts.C, fill: "F9E27D" },
    { label: "SAKIT", value: counts.S, fill: "F5B041" },
    { label: "DAY OFF", value: counts.DO, fill: "C39BD3" },
    { label: "ABSENT", value: counts.TK, fill: "FF5A36" },
    { label: "TOTAL HARI KERJA", value: counts.TOTAL, fill: "FFD966" },
    { label: "TOTAL TELAT (MENIT)", value: lateTotal, fill: "FFD966" },
  ]
  summary.forEach((s, i) => {
    const label = sheet.getCell(summaryStart + i, 1)
    label.value = s.label
    label.font = { bold: true, size: 10, color: { argb: "FF3F3F3F" } }
    label.fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.fill } }
    label.border = thin
    const val = sheet.getCell(summaryStart + i, 2)
    val.value = s.value
    val.font = { bold: true, size: 10 }
    val.alignment = { horizontal: "center" }
    val.fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.fill } }
    val.border = thin
  })

  sheet.getColumn(1).width = 30
  sheet.getColumn(2).width = 10
  sheet.getColumn(3).width = 11
  sheet.getColumn(4).width = 11
  sheet.getColumn(5).width = 14
  sheet.getColumn(6).width = 11
  sheet.getColumn(7).width = 40
  return workbook.xlsx.writeBuffer()
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const parsed = attendanceHistoryQuerySchema.safeParse({
      scope: request.nextUrl.searchParams.get("scope") ?? undefined,
      officeLocationId: request.nextUrl.searchParams.get("officeLocationId") ?? undefined,
      userId: request.nextUrl.searchParams.get("userId") ?? undefined,
      dateFrom: request.nextUrl.searchParams.get("dateFrom") ?? undefined,
      dateTo: request.nextUrl.searchParams.get("dateTo") ?? undefined,
      month: request.nextUrl.searchParams.get("month") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      checkInStatus: request.nextUrl.searchParams.get("checkInStatus") ?? undefined,
      checkOutStatus: request.nextUrl.searchParams.get("checkOutStatus") ?? undefined,
      isCorrected: request.nextUrl.searchParams.get("isCorrected") ?? undefined,
      attendanceDayType: request.nextUrl.searchParams.get("attendanceDayType") ?? undefined,
      requestType: request.nextUrl.searchParams.get("requestType") ?? undefined,
      requestStatus: request.nextUrl.searchParams.get("requestStatus") ?? undefined,
      format: request.nextUrl.searchParams.get("format") ?? undefined,
      // Was missing from this list, so `compact=1` never reached the parser: the widget, the watch
      // and the crew board asked for dots and got full rows their decoder could not read.
      compact: request.nextUrl.searchParams.get("compact") ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const scope = parsed.data.scope ?? "me"
    // BoD/OAA melihat seluruh workspace; seorang MANAGER hanya orang-orang di bawahnya di Bagan
    // Approval. (Dulu: anggota tim yang dia pimpin — lead tim sudah tidak ada.)
    const isTeamManager = !context.canManageAttendance && context.directReportIds.length > 0
    if (scope === "workspace" && !context.canManageAttendance && !isTeamManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let teamScopeUserIds: string[] | null = null
    if (scope === "workspace" && isTeamManager) {
      // Their reports AND themselves. The board is the only place a manager's own history shows,
      // and scoping it to the reports alone made their own month vanish the day they got one.
      teamScopeUserIds = [...new Set([...context.directReportIds, session.user.id])]
    }

    const range = parsed.data.month
      ? attendancePeriodRange(parsed.data.month)
      : {
          start: new Date(`${parsed.data.dateFrom ?? formatAttendanceDateKey()}T00:00:00.000Z`),
          end: new Date(`${parsed.data.dateTo ?? parsed.data.dateFrom ?? formatAttendanceDateKey()}T00:00:00.000Z`),
        }

    // BoD and One Above All are exempt from attendance — the nightly cron never penalises them
    // (attendance-absence.ts) — so a workspace-wide board and the Sheets export leave them out.
    // They still see their own history under "me", and can still be asked for by userId.
    const exemptUserIds =
      scope === "me" || parsed.data.userId || teamScopeUserIds
        ? []
        : (
            await prisma.workspaceMember.findMany({
              where: { workspaceId: context.workspace.id, role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
              select: { userId: true },
            })
          ).map((m) => m.userId)

    const userWhere: Record<string, unknown> =
      scope === "me"
        ? { userId: session.user.id }
        : teamScopeUserIds
          ? (parsed.data.userId && teamScopeUserIds.includes(parsed.data.userId)
              ? { userId: parsed.data.userId }
              : { userId: { in: teamScopeUserIds } })
          : parsed.data.userId
            ? { userId: parsed.data.userId }
            : exemptUserIds.length
              ? { userId: { notIn: exemptUserIds } }
              : {}

    const recordWhere: Record<string, unknown> = {
      workspaceId: context.workspace.id,
      ...userWhere,
      attendanceDate: {
        gte: range.start,
        lte: range.end,
      },
    }

    if (parsed.data.officeLocationId) {
      recordWhere.officeLocationId = parsed.data.officeLocationId
    }

    const requestWhere: Record<string, unknown> = {
      workspaceId: context.workspace.id,
      ...userWhere,
      status: "APPROVED",
      startDate: { lte: range.end },
      endDate: { gte: range.start },
    }

    if (parsed.data.requestType) {
      requestWhere.type = parsed.data.requestType
    }

    const isFileExport = parsed.data.format === "csv" || parsed.data.format === "xlsx"

    const [records, approvedRequests, activeOffices, workspaceMembers] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: recordWhere,
        include: {
          officeLocation: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
          correctedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ attendanceDate: "desc" }, { checkInAt: "desc" }],
        take: isFileExport ? 5000 : scope === "me" ? 600 : 4000,
      }),
      prisma.attendanceRequest.findMany({
        where: requestWhere,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
          reviewedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          team: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      }),
      prisma.officeLocation.findMany({
        where: {
          workspaceId: context.workspace.id,
          isActive: true,
          ...(parsed.data.officeLocationId ? { id: parsed.data.officeLocationId } : {}),
        },
        orderBy: [{ createdAt: "asc" }],
      }),
      prisma.workspaceMember.findMany({
        where: {
          workspaceId: context.workspace.id,
          ...userWhere,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
              createdAt: true,
            },
          },
        },
      }),
    ])

    // The day rules below (record → request replaces it → absent on past workdays) are mirrored in
    // src/lib/attendance-days.ts for Reports per crew. Change one, change the other.
    const fallbackOffice = activeOffices[0] ?? null
    const rowMap = new Map<string, HistoryRow>()

    for (const record of records) {
      const serialized = serializeAttendanceRecord(record)
      const key = `${serialized.user.id}:${serialized.attendanceDate.slice(0, 10)}`
      rowMap.set(key, {
        ...serialized,
        recordKind: "ATTENDANCE",
        attendanceDayType: "PRESENT",
        requestType: null,
        requestStatus: null,
        approvalSource: null,
        reviewedAt: null,
        reviewedBy: null,
        hasSupportingDocument: false,
        supportingDocumentUrl: null,
        supportingDocumentName: null,
      })
    }

    for (const approvedRequest of approvedRequests) {
      const dayType = mapRequestTypeToAttendanceDayType(approvedRequest.type)
      // The cron's auto-deduction day-off is a PENALTY row, not a day off the person took. It never
      // describes the day: ">120 min late" was a day they were present (the record stays), and
      // "tidak check-in" was a day they were absent — which the ABSENT pass below fills in as TK.
      // Rendering it as DO (purple) told the BoD somebody took leave when they simply did not show up
      // (17 Sep 2026). The token is still deducted; that lives in the quota count, not here.
      const isAutoPenalty = isAutoDeduction(approvedRequest)
      if (isAutoPenalty) continue
      for (const date of enumerateAttendanceDates(approvedRequest.startDate, approvedRequest.endDate)) {
        if (date.getTime() < range.start.getTime() || date.getTime() > range.end.getTime()) continue
        const dateKey = date.toISOString().slice(0, 10)
        const key = `${approvedRequest.userId}:${dateKey}`
        rowMap.set(key, {
          id: `request-${approvedRequest.id}-${dateKey}`,
          attendanceDate: date.toISOString(),
          checkInAt: null,
          checkOutAt: null,
          checkInStatus: null,
          checkOutStatus: null,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          workedMinutes: 0,
          shiftStartAt: null,
          shiftEndAt: null,
          effectiveShiftSource: "OFFICE",
          effectiveTeamId: approvedRequest.teamId ?? null,
          effectiveTeamName: approvedRequest.team?.name ?? null,
          effectiveShiftStartTime: fallbackOffice?.shiftStartTime ?? null,
          effectiveShiftEndTime: fallbackOffice?.shiftEndTime ?? null,
          checkInLat: null,
          checkInLng: null,
          checkOutLat: null,
          checkOutLng: null,
          checkInAddress: null,
          checkOutAddress: null,
          checkInPhotoUrl: null,
          checkOutPhotoUrl: null,
          checkInDistanceMeters: null,
          checkOutDistanceMeters: null,
          checkOutOffsite: false,
          checkOutApproval: null,
          checkOutReason: null,
          checkOutReflection: null,
          checkOutReflectionAt: null,
          outsideSince: null,
          locationTrackingState: null,
          checkInClient: null,
          notes: approvedRequest.reason,
          status: "COMPLETED",
          correctedAt: null,
          correctionReason: null,
          isCorrected: false,
          officeLocation: {
            id: fallbackOffice?.id ?? "no-office",
            name: fallbackOffice?.name ?? "No office configured",
            address: fallbackOffice?.address ?? null,
            latitude: fallbackOffice?.latitude ?? 0,
            longitude: fallbackOffice?.longitude ?? 0,
            radiusMeters: fallbackOffice?.radiusMeters ?? 0,
            timezone: fallbackOffice?.timezone ?? "Asia/Jakarta",
            workdays: fallbackOffice?.workdays ?? [1, 2, 3, 4, 5, 6, 7],
            shiftStartTime: fallbackOffice?.shiftStartTime ?? "09:00",
            shiftEndTime: fallbackOffice?.shiftEndTime ?? "18:00",
            lateGraceMinutes: fallbackOffice?.lateGraceMinutes ?? 0,
            earlyLeaveGraceMinutes: fallbackOffice?.earlyLeaveGraceMinutes ?? 0,
            isActive: fallbackOffice?.isActive ?? false,
          },
          user: approvedRequest.user,
          correctedBy: null,
          recordKind: "REQUEST",
          attendanceDayType: dayType,
          requestType: approvedRequest.type,
          requestStatus: "APPROVED",
          approvalSource: approvedRequest.approvalSource ?? null,
          reviewedAt: approvedRequest.reviewedAt?.toISOString() ?? null,
          reviewedBy: approvedRequest.reviewedBy,
          hasSupportingDocument: Boolean(approvedRequest.supportingDocumentUrl),
          supportingDocumentUrl: approvedRequest.supportingDocumentUrl ?? null,
          supportingDocumentName: approvedRequest.supportingDocumentName ?? null,
        })
      }
    }

    if (fallbackOffice) {
      // An "absent" row is a claim, and the board now paints it red — so it is only made for days
      // that could actually have been missed: past workdays that were neither a public holiday nor a
      // NEXUS-down day. Today is still open, the future has not happened, and a holiday is nobody's
      // absence. (Before this the row existed for every date in range and was drawn grey, so the
      // over-reach never showed.)
      const todayKey = formatAttendanceDateKey()
      const [holidayKeys, outageKeys, firstRecords] = await Promise.all([
        getHolidayKeys(context.workspace.id, range.start, range.end),
        getOutageDateKeysForRange(range.start, range.end),
        prisma.attendanceRecord.groupBy({ by: ["userId"], where: { workspaceId: context.workspace.id }, _min: { attendanceDate: true } }),
      ])
      // Nobody is absent before their first day. A hire who started on the 14th used to get a red
      // cell for every workday since the 28th (and a TK on the sheet): the day they joined the
      // workspace, or their first check-in if that came earlier, is where their month begins. The
      // nightly cron has had the same guard for months; the board and the export did not.
      const firstRecordKey = new Map(firstRecords.map((r) => [r.userId, r._min.attendanceDate ? formatAttendanceDateKey(r._min.attendanceDate) : null] as const))
      const startKeyOf = (m: (typeof workspaceMembers)[number]) => {
        const join = formatAttendanceDateKey(m.joinedAt ?? m.user.createdAt ?? new Date(0))
        const first = firstRecordKey.get(m.user.id) ?? null
        return first && first < join ? first : join
      }
      for (const member of workspaceMembers) {
        const startKey = startKeyOf(member)
        for (const date of enumerateAttendanceDates(range.start, range.end)) {
          if (!isWorkdayForAttendanceDate(date, fallbackOffice)) continue
          if (formatAttendanceDateKey(date) < startKey) continue
          // Their fixed rest day is not an absence — no red cell, no TK on the sheet.
          if (isRestDayForMember(date, member.restDays, fallbackOffice.timezone)) continue
          const dateKey = date.toISOString().slice(0, 10)
          if (dateKey >= todayKey || holidayKeys.has(dateKey) || outageKeys.has(dateKey)) continue
          const key = `${member.user.id}:${dateKey}`
          if (rowMap.has(key)) continue

          rowMap.set(key, {
            id: `absent-${member.user.id}-${dateKey}`,
            attendanceDate: date.toISOString(),
            checkInAt: null,
            checkOutAt: null,
            checkInStatus: null,
            checkOutStatus: null,
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
            workedMinutes: 0,
            shiftStartAt: null,
            shiftEndAt: null,
            effectiveShiftSource: "OFFICE",
            effectiveTeamId: null,
            effectiveTeamName: null,
            effectiveShiftStartTime: fallbackOffice.shiftStartTime,
            effectiveShiftEndTime: fallbackOffice.shiftEndTime,
            checkInLat: null,
            checkInLng: null,
            checkOutLat: null,
            checkOutLng: null,
            checkInAddress: null,
            checkOutAddress: null,
            checkInPhotoUrl: null,
            checkOutPhotoUrl: null,
            checkInDistanceMeters: null,
            checkOutDistanceMeters: null,
            checkOutOffsite: false,
            checkOutApproval: null,
            checkOutReason: null,
            checkOutReflection: null,
            checkOutReflectionAt: null,
            outsideSince: null,
            locationTrackingState: null,
            checkInClient: null,
            notes: null,
            status: "INCOMPLETE",
            correctedAt: null,
            correctionReason: null,
            isCorrected: false,
            officeLocation: {
              id: fallbackOffice.id,
              name: fallbackOffice.name,
              address: fallbackOffice.address ?? null,
              latitude: fallbackOffice.latitude,
              longitude: fallbackOffice.longitude,
              radiusMeters: fallbackOffice.radiusMeters,
              timezone: fallbackOffice.timezone,
              workdays: fallbackOffice.workdays,
              shiftStartTime: fallbackOffice.shiftStartTime,
              shiftEndTime: fallbackOffice.shiftEndTime,
              lateGraceMinutes: fallbackOffice.lateGraceMinutes,
              earlyLeaveGraceMinutes: fallbackOffice.earlyLeaveGraceMinutes,
              isActive: fallbackOffice.isActive,
            },
            user: member.user,
            correctedBy: null,
            recordKind: "ABSENT",
            attendanceDayType: "ABSENT",
            requestType: null,
            requestStatus: null,
            approvalSource: null,
            reviewedAt: null,
            reviewedBy: null,
            hasSupportingDocument: false,
            supportingDocumentUrl: null,
            supportingDocumentName: null,
          })
        }
      }
    }

    const rows = sortRows(Array.from(rowMap.values())).filter((row) => {
      if (parsed.data.status && row.recordKind === "ATTENDANCE" && row.status !== parsed.data.status) {
        return false
      }
      if (parsed.data.status && row.recordKind !== "ATTENDANCE") {
        return false
      }

      if (parsed.data.checkInStatus && row.checkInStatus !== parsed.data.checkInStatus) {
        return false
      }

      if (parsed.data.checkOutStatus && row.checkOutStatus !== parsed.data.checkOutStatus) {
        return false
      }

      if (parsed.data.isCorrected) {
        if ((parsed.data.isCorrected === "true" && !row.isCorrected) || (parsed.data.isCorrected === "false" && row.isCorrected)) {
          return false
        }
      }

      if (parsed.data.attendanceDayType && row.attendanceDayType !== parsed.data.attendanceDayType) {
        return false
      }

      if (parsed.data.requestType && row.requestType !== parsed.data.requestType) {
        return false
      }

      if (parsed.data.requestStatus && row.requestStatus !== parsed.data.requestStatus) {
        return false
      }

      return true
    })

    if (parsed.data.format === "xlsx" && parsed.data.userId) {
      const fromRows = rows[0]?.user
      const person = fromRows
        ? { name: fromRows.name || fromRows.email || "Crew", email: fromRows.email }
        : await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { name: true, email: true } }).then((u) => ({ name: u?.name || u?.email || "Crew", email: u?.email ?? null }))
      const personQuota = (await dayOffQuotaByUser(context.workspace.id, [parsed.data.userId])).get(parsed.data.userId)
      const personBuffer = await buildPersonWorkbook({ rows, start: range.start, end: range.end, workspaceName: context.workspace.name, person, dayOffQuota: personQuota })
      const slug = person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "crew"
      return new NextResponse(personBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="absensi-${slug}-${parsed.data.month ?? range.end.toISOString().slice(0, 7)}.xlsx"`,
        },
      })
    }

    if (parsed.data.format === "xlsx") {
      const exportUserIds = [...new Set(rows.map((r) => r.user.id))]
      const workbookBuffer = await buildAttendanceWorkbook({
        rows,
        start: range.start,
        end: range.end,
        workspaceName: context.workspace.name,
        quotaByUser: await dayOffQuotaByUser(context.workspace.id, exportUserIds),
      })

      return new NextResponse(Buffer.from(workbookBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="attendance-${parsed.data.month ?? range.end.toISOString().slice(0, 7)}.xlsx"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }

    if (parsed.data.format === "csv") {
      const headers = [
        "date",
        "user_name",
        "user_email",
        "office_name",
        "attendance_day_type",
        "request_type",
        "request_status",
        "approval_source",
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
        "reviewed_by",
        "reviewed_at",
        "has_supporting_document",
        "is_corrected",
        "correction_reason",
        "notes",
      ]

      const csv = [headers, ...rows.map((row) => [
        formatAttendanceDateKey(new Date(row.attendanceDate)),
        row.user.name,
        row.user.email,
        row.officeLocation.name,
        row.attendanceDayType,
        row.requestType ?? "",
        row.requestStatus ?? "",
        row.approvalSource ?? "",
        row.effectiveShiftSource ?? "",
        row.effectiveTeamName ?? "",
        row.effectiveShiftStartTime ?? "",
        row.effectiveShiftEndTime ?? "",
        row.checkInAt ?? "",
        row.checkOutAt ?? "",
        row.workedMinutes,
        row.status,
        row.checkInStatus ?? "",
        row.checkOutStatus ?? "",
        row.lateMinutes,
        row.earlyLeaveMinutes,
        row.reviewedBy?.name ?? "",
        row.reviewedAt ?? "",
        row.hasSupportingDocument ? "yes" : "no",
        row.isCorrected ? "yes" : "no",
        row.correctionReason ?? "",
        row.notes ?? "",
      ])]
        .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
        .join("\n")

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="attendance-${parsed.data.month ?? range.end.toISOString().slice(0, 7)}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }

    if (parsed.data.compact === "1") {
      // The dots a watch face or a widget draws: who, which day, what colour, and the two times.
      // `tone` is decided here so every client colours the same day the same way: P present,
      // L late, I permit, C leave, S sick, D day off, A absent, blank = nothing that day.
      const toneOf = (r: HistoryRow) => {
        switch (r.attendanceDayType) {
          case "PRESENT": return (r.lateMinutes ?? 0) > 0 ? "L" : "P"
          case "PERMIT_APPROVED": return "I"
          case "LEAVE_APPROVED": return "C"
          case "SICK_APPROVED": return "S"
          case "DAY_OFF_APPROVED": return "D"
          case "ABSENT": return "A"
          default: return r.checkInAt ? "P" : ""
        }
      }
      return NextResponse.json({
        scope,
        records: rows.map((r) => ({
          userId: r.user.id, name: r.user.name, date: r.attendanceDate.slice(0, 10), tone: toneOf(r),
          checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, lateMinutes: r.lateMinutes ?? 0, kind: r.recordKind,
        })),
      })
    }

    return NextResponse.json({
      scope,
      records: rows,
    })
  } catch (error) {
    console.error("Error fetching attendance history:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
