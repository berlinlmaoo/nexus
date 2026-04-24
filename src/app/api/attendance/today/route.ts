import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import {
  endOfAttendanceMonth,
  formatAttendanceDateKey,
  getAttendanceDate,
  getAttendanceWorkspaceContext,
  serializeAttendanceRequest,
  startOfAttendanceMonth,
  serializeAttendanceRecord,
} from "@/lib/attendance"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const attendanceDate = getAttendanceDate()
    const [todayRecord, activeOfficeCount, todayRequest, dayOffRequests] = await prisma.$transaction([
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
    ])

    return NextResponse.json({
      attendanceDateKey: formatAttendanceDateKey(),
      workspace: context.workspace,
      activeOfficeCount,
      today: todayRecord ? serializeAttendanceRecord(todayRecord) : null,
      todayRequest: todayRequest ? serializeAttendanceRequest(todayRequest) : null,
      dayOffUsedThisMonth: dayOffRequests.reduce((count: number, requestItem) => {
        const start = startOfAttendanceMonth(new Date())
        const end = endOfAttendanceMonth(new Date())
        const days = Math.max(
          0,
          Math.floor((Math.min(requestItem.endDate.getTime(), end.getTime()) - Math.max(requestItem.startDate.getTime(), start.getTime())) / 86_400_000) + 1
        )
        return count + days
      }, 0),
      canManageAttendance: context.canManageAttendance,
      canReviewAttendanceRequests: context.canReviewAttendanceRequests,
    })
  } catch (error) {
    console.error("Error fetching today's attendance:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
