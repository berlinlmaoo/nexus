export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  AttendanceDayType,
  attendancePeriodRange,
  enumerateAttendanceDates,
  formatAttendanceDateKey,
  getAttendanceWorkspaceContext,
  isWorkdayForAttendanceDate,
  mapRequestTypeToAttendanceDayType,
  serializeAttendanceRecord,
} from "@/lib/attendance"
import { isAutoDeduction } from "@/lib/attendance-absence"
import { attendanceHistoryQuerySchema } from "@/lib/validations"

const ATTENDANCE_EXPORT_TIMEZONE = "Asia/Jakarta"

type HistoryRow = ReturnType<typeof serializeAttendanceRecord> & {
  recordKind: "ATTENDANCE" | "REQUEST" | "ABSENT"
  attendanceDayType: AttendanceDayType
  requestType: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF" | "RED_DATE" | null
  requestStatus: "APPROVED" | null
  approvalSource: "ADMIN" | "ATTENDANCE_SUPERVISOR" | "TEAM_HEAD" | null
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

function formatExportPeriod(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: ATTENDANCE_EXPORT_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

  return `${formatter.format(start)} - ${formatter.format(end)}`
}

function formatExportDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ATTENDANCE_EXPORT_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function getAttendanceExportCode(row: HistoryRow | undefined) {
  if (!row) return ""
  switch (row.attendanceDayType) {
    case "PRESENT":
      return "H"
    case "LEAVE_APPROVED":
      return "C"
    case "SICK_APPROVED":
      return "S"
    case "PERMIT_APPROVED":
      return "I"
    case "DAY_OFF_APPROVED":
      return "DO"
    case "ABSENT":
      return "TK"
    default:
      return ""
  }
}

function getAttendanceExportFill(code: string) {
  switch (code) {
    case "H":
      return "7CFC00"
    case "C":
      return "F9E27D"
    case "S":
      return "F5B041"
    case "I":
      return "85C1E9"
    case "DO":
      return "C39BD3"
    case "TK":
      return "FF5A36"
    default:
      return "FFFFFF"
  }
}

async function buildAttendanceWorkbook({
  rows,
  start,
  end,
  workspaceName,
}: {
  rows: HistoryRow[]
  start: Date
  end: Date
  workspaceName: string
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
          counter.TOTAL += 1
        }
      }
    })
  })

  const summaryStartRow = 6 + dates.length
  const summaryRows = [
    { label: "HADIR", code: "H", fill: "7CFC00" },
    { label: "CUTI", code: "C", fill: "F9E27D" },
    { label: "SAKIT", code: "S", fill: "F5B041" },
    { label: "IZIN", code: "I", fill: "85C1E9" },
    { label: "DAY OFF", code: "DO", fill: "C39BD3" },
    { label: "ABSENT", code: "TK", fill: "FF5A36" },
    { label: "TOTAL HARI KERJA", code: "TOTAL", fill: "FFD966" },
  ] as const

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
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const scope = parsed.data.scope ?? "me"
    // Full managers (BoD/OAA) see the whole workspace; a MANAGER who leads team(s) sees only those teams.
    const isTeamManager = !context.canManageAttendance && context.teamLeadTeamIds.length > 0
    if (scope === "workspace" && !context.canManageAttendance && !isTeamManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let teamScopeUserIds: string[] | null = null
    if (scope === "workspace" && isTeamManager) {
      const teamMembers = await prisma.teamMember.findMany({
        where: { teamId: { in: context.teamLeadTeamIds } },
        select: { userId: true },
      })
      teamScopeUserIds = Array.from(new Set(teamMembers.map((m) => m.userId)))
    }

    const range = parsed.data.month
      ? attendancePeriodRange(parsed.data.month)
      : {
          start: new Date(`${parsed.data.dateFrom ?? formatAttendanceDateKey()}T00:00:00.000Z`),
          end: new Date(`${parsed.data.dateTo ?? parsed.data.dateFrom ?? formatAttendanceDateKey()}T00:00:00.000Z`),
        }

    const userWhere: Record<string, unknown> =
      scope === "me"
        ? { userId: session.user.id }
        : teamScopeUserIds
          ? (parsed.data.userId && teamScopeUserIds.includes(parsed.data.userId)
              ? { userId: parsed.data.userId }
              : { userId: { in: teamScopeUserIds } })
          : parsed.data.userId
            ? { userId: parsed.data.userId }
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
            },
          },
        },
      }),
    ])

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
      // The cron's auto-deduction day-off (a penalty, e.g. ">120 min late → −1 token") is filed for a
      // day the staff was actually PRESENT. It must not hide their real check-in/out: if a present
      // record already exists for the day, keep it (the token is still deducted via the quota count).
      const isAutoPenalty = isAutoDeduction(approvedRequest)
      for (const date of enumerateAttendanceDates(approvedRequest.startDate, approvedRequest.endDate)) {
        if (date.getTime() < range.start.getTime() || date.getTime() > range.end.getTime()) continue
        const dateKey = date.toISOString().slice(0, 10)
        const key = `${approvedRequest.userId}:${dateKey}`
        if (isAutoPenalty && rowMap.get(key)?.recordKind === "ATTENDANCE") continue
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
      for (const member of workspaceMembers) {
        for (const date of enumerateAttendanceDates(range.start, range.end)) {
          if (!isWorkdayForAttendanceDate(date, fallbackOffice)) continue
          const dateKey = date.toISOString().slice(0, 10)
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

    if (parsed.data.format === "xlsx") {
      const workbookBuffer = await buildAttendanceWorkbook({
        rows,
        start: range.start,
        end: range.end,
        workspaceName: context.workspace.name,
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

    return NextResponse.json({
      scope,
      records: rows,
    })
  } catch (error) {
    console.error("Error fetching attendance history:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
