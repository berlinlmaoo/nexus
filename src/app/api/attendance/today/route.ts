export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  endOfAttendanceMonth,
  formatAttendanceDateKey,
  getAttendanceDate,
  getAttendanceWorkspaceContext,
  getMemberNoGeofence,
  resolveEffectiveAttendanceShift,
  serializeAttendanceRequest,
  startOfAttendanceMonth,
  serializeAttendanceRecord,
} from "@/lib/attendance"
import { clearLeaveCoveredOpenRecords } from "@/lib/attendance-absence"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const attendanceDate = getAttendanceDate()
    const [todayRecord, activeOfficeCount, todayRequest, dayOffRequests, pendingCheckoutRecord] = await prisma.$transaction([
      prisma.attendanceRecord.findUnique({
        where: {
          userId_workspaceId_attendanceDate: {
            userId: session.user.id,
            workspaceId: context.workspace.id,
            attendanceDate,
          },
        },
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
      }),
      prisma.officeLocation.count({
        where: {
          workspaceId: context.workspace.id,
          isActive: true,
        },
      }),
      prisma.attendanceRequest.findFirst({
        where: {
          userId: session.user.id,
          workspaceId: context.workspace.id,
          status: "APPROVED",
          startDate: { lte: attendanceDate },
          endDate: { gte: attendanceDate },
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
      }),
      prisma.attendanceRequest.findMany({
        where: {
          userId: session.user.id,
          workspaceId: context.workspace.id,
          type: "DAY_OFF",
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lte: endOfAttendanceMonth(new Date()) },
          endDate: { gte: startOfAttendanceMonth(new Date()) },
        },
        select: {
          startDate: true,
          endDate: true,
        },
      }),
      prisma.attendanceRecord.findFirst({
        where: {
          userId: session.user.id,
          workspaceId: context.workspace.id,
          status: "CHECKED_IN",
          attendanceDate: { lt: attendanceDate },
        },
        orderBy: { attendanceDate: "asc" },
        include: {
          officeLocation: true,
          user: { select: { id: true, name: true, email: true, avatar: true } },
          correctedBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ])

    // Self-heal: a leave/day-off approved AFTER the staff checked in leaves a stuck open record that
    // can't be checked out (the covering request blocks it) and forces a perpetual "Selesaikan absen
    // kemarin". If the pending record's day is now covered by a real approved leave, drop it so the
    // UI shows a clean "Ready to check in".
    let pendingCheckout = pendingCheckoutRecord
    if (pendingCheckout) {
      const cleared = await clearLeaveCoveredOpenRecords(session.user.id, context.workspace.id)
      if (cleared.includes(pendingCheckout.id)) pendingCheckout = null
    }

    const quotaMember = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.user.id, workspaceId: context.workspace.id } },
      select: { dayOffQuota: true },
    })

    // Tanggal merah (RED_DATE): this user's usage + the month's BoD-set quota (same for all staff).
    const currentMonthKey = formatAttendanceDateKey().slice(0, 7)
    const [redDateRequests, redDateQuotaRow] = await Promise.all([
      prisma.attendanceRequest.findMany({
        where: {
          userId: session.user.id,
          workspaceId: context.workspace.id,
          type: "RED_DATE",
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lte: endOfAttendanceMonth(new Date()) },
          endDate: { gte: startOfAttendanceMonth(new Date()) },
        },
        select: { startDate: true, endDate: true },
      }),
      prisma.redDateQuota.findUnique({
        where: { workspaceId_month: { workspaceId: context.workspace.id, month: currentMonthKey } },
        select: { quota: true },
      }),
    ])
    const _mStart = startOfAttendanceMonth(new Date())
    const _mEnd = endOfAttendanceMonth(new Date())
    const redDateUsed = redDateRequests.reduce((c, r) => c + Math.max(0, Math.floor((Math.min(r.endDate.getTime(), _mEnd.getTime()) - Math.max(r.startDate.getTime(), _mStart.getTime())) / 86_400_000) + 1), 0)

    // The user's effective shift for the "My Work Schedule" display (resolved pre-check-in against
    // the first active office; USER/TEAM overrides are office-independent anyway).
    const firstOffice = await prisma.officeLocation.findFirst({ where: { workspaceId: context.workspace.id, isActive: true } })
    let myShift: { startTime: string; endTime: string; source: string; flexi?: boolean } | null = null
    if (firstOffice) {
      const shift = await resolveEffectiveAttendanceShift({ userId: session.user.id, workspaceId: context.workspace.id, office: firstOffice })
      myShift = { startTime: shift.shiftStartTime, endTime: shift.shiftEndTime, source: shift.source, flexi: shift.flexi }
    }
    const noGeofence = await getMemberNoGeofence(session.user.id, context.workspace.id)

    return NextResponse.json({
      attendanceDateKey: formatAttendanceDateKey(),
      workspace: context.workspace,
      activeOfficeCount,
      today: todayRecord ? serializeAttendanceRecord(todayRecord) : null,
      pendingCheckout: pendingCheckout ? serializeAttendanceRecord(pendingCheckout) : null,
      todayRequest: todayRequest ? serializeAttendanceRequest(todayRequest) : null,
      dayOffQuota: quotaMember?.dayOffQuota ?? 4,
      dayOffUsedThisMonth: dayOffRequests.reduce((count: number, requestItem) => {
        const start = startOfAttendanceMonth(new Date())
        const end = endOfAttendanceMonth(new Date())
        const days = Math.max(
          0,
          Math.floor((Math.min(requestItem.endDate.getTime(), end.getTime()) - Math.max(requestItem.startDate.getTime(), start.getTime())) / 86_400_000) + 1
        )
        return count + days
      }, 0),
      redDateQuota: redDateQuotaRow?.quota ?? 0,
      redDateUsedThisMonth: redDateUsed,
      myShift,
      noGeofence,
      canManageAttendance: context.canManageAttendance,
      canReviewAttendanceRequests: context.canReviewAttendanceRequests,
    })
  } catch (error) {
    console.error("Error fetching today's attendance:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
