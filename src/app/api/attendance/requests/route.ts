import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import {
  attendanceMonthRange,
  endOfAttendanceMonth,
  enumerateAttendanceDates,
  getAttendanceWorkspaceContext,
  getPrimaryAttendanceTeam,
  parseDateOnlyToUtc,
  serializeAttendanceRequest,
  startOfAttendanceMonth,
} from "@/lib/attendance"
import {
  attendanceRequestCreateSchema,
  attendanceRequestQuerySchema,
} from "@/lib/validations"

const MAX_SUPPORTING_DOCUMENT_SIZE = 10 * 1024 * 1024

function overlapsRange(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date
) {
  return leftStart.getTime() <= rightEnd.getTime() && leftEnd.getTime() >= rightStart.getTime()
}

function formatMonthKey(date: Date) {
  return date.toISOString().slice(0, 7)
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const parsed = attendanceRequestQuerySchema.safeParse({
      scope: request.nextUrl.searchParams.get("scope") ?? undefined,
      month: request.nextUrl.searchParams.get("month") ?? undefined,
      userId: request.nextUrl.searchParams.get("userId") ?? undefined,
      teamId: request.nextUrl.searchParams.get("teamId") ?? undefined,
      type: request.nextUrl.searchParams.get("type") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const scope = parsed.data.scope ?? "me"
    if ((scope === "workspace" || scope === "approvals") && !context.canReviewAttendanceRequests) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const where: Record<string, unknown> = {
      workspaceId: context.workspace.id,
    }

    if (scope === "me") {
      where.userId = session.user.id
    } else if (scope === "workspace") {
      if (parsed.data.userId) where.userId = parsed.data.userId
      if (parsed.data.teamId) where.teamId = parsed.data.teamId
    } else if (scope === "approvals") {
      if (context.canManageAttendance) {
        if (parsed.data.userId) where.userId = parsed.data.userId
        if (parsed.data.teamId) where.teamId = parsed.data.teamId
      } else {
        where.teamId = {
          in: context.teamLeadTeamIds,
        }
      }
    }

    if (parsed.data.type) where.type = parsed.data.type
    if (parsed.data.status) where.status = parsed.data.status

    if (parsed.data.month) {
      const { start, end } = attendanceMonthRange(parsed.data.month)
      where.AND = [
        { startDate: { lte: end } },
        { endDate: { gte: start } },
      ]
    }

    const requests = await prisma.attendanceRequest.findMany({
      where,
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
      orderBy: [{ createdAt: "desc" }],
      take: scope === "me" ? 200 : 1000,
    })

    const now = new Date()
    const monthStart = startOfAttendanceMonth(now)
    const monthEnd = endOfAttendanceMonth(now)
    const currentUserDayOffs = await prisma.attendanceRequest.findMany({
      where: {
        userId: session.user.id,
        type: "DAY_OFF",
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: {
        startDate: true,
        endDate: true,
      },
    })

    const dayOffUsedThisMonth = currentUserDayOffs.reduce((count: number, requestItem) => {
      return (
        count +
        enumerateAttendanceDates(requestItem.startDate, requestItem.endDate).filter(
          (date) => overlapsRange(date, date, monthStart, monthEnd)
        ).length
      )
    }, 0)

    return NextResponse.json({
      scope,
      dayOffUsedThisMonth,
      requests: requests.map((attendanceRequest) => serializeAttendanceRequest(attendanceRequest)),
    })
  } catch (error) {
    console.error("Error fetching attendance requests:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const formData = await request.formData()
    const type = String(formData.get("type") ?? "")
    const startDate = String(formData.get("startDate") ?? "")
    const endDate = String(formData.get("endDate") ?? "")
    const reason = String(formData.get("reason") ?? "")
    const supportingDocument = formData.get("supportingDocument")

    const validation = attendanceRequestCreateSchema.safeParse({
      type,
      startDate,
      endDate,
      reason,
    })

    if (!validation.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const parsedStartDate = parseDateOnlyToUtc(validation.data.startDate)
    const parsedEndDate = parseDateOnlyToUtc(validation.data.endDate)
    if (parsedEndDate.getTime() < parsedStartDate.getTime()) {
      return NextResponse.json({ error: "End date cannot be earlier than start date." }, { status: 400 })
    }

    const [existingRequests, existingAttendance, primaryAttendanceTeam] = await Promise.all([
      prisma.attendanceRequest.findMany({
        where: {
          userId: session.user.id,
          workspaceId: context.workspace.id,
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lte: parsedEndDate },
          endDate: { gte: parsedStartDate },
        },
        select: {
          id: true,
          startDate: true,
          endDate: true,
        },
      }),
      prisma.attendanceRecord.findMany({
        where: {
          userId: session.user.id,
          workspaceId: context.workspace.id,
          attendanceDate: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          OR: [
            { checkInAt: { not: null } },
            { checkOutAt: { not: null } },
          ],
        },
        select: {
          id: true,
        },
      }),
      getPrimaryAttendanceTeam(session.user.id, context.workspace.id),
    ])

    if (existingRequests.length > 0) {
      return NextResponse.json({ error: "This request overlaps with another active attendance request." }, { status: 409 })
    }

    if (existingAttendance.length > 0) {
      return NextResponse.json({ error: "Attendance already exists for one or more selected dates." }, { status: 409 })
    }

    if (
      supportingDocument instanceof File &&
      (supportingDocument.size <= 0 || supportingDocument.size > MAX_SUPPORTING_DOCUMENT_SIZE)
    ) {
      return NextResponse.json({ error: "Supporting document must be smaller than 10MB." }, { status: 400 })
    }

    if (validation.data.type === "DAY_OFF") {
      const requestDates = enumerateAttendanceDates(parsedStartDate, parsedEndDate)
      const monthCounts = new Map<string, number>()

      for (const date of requestDates) {
        const monthKey = formatMonthKey(date)
        monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1)
      }

      const monthWindows = Array.from(monthCounts.keys()).map((monthKey) => ({
        monthKey,
        ...attendanceMonthRange(monthKey),
      }))

      const existingDayOffRequests = await prisma.attendanceRequest.findMany({
        where: {
          userId: session.user.id,
          type: "DAY_OFF",
          status: { in: ["PENDING", "APPROVED"] },
          OR: monthWindows.map((window) => ({
            startDate: { lte: window.end },
            endDate: { gte: window.start },
          })),
        },
        select: {
          startDate: true,
          endDate: true,
        },
      })

      const existingMonthCounts = new Map<string, number>()
      for (const requestItem of existingDayOffRequests) {
        for (const date of enumerateAttendanceDates(requestItem.startDate, requestItem.endDate)) {
          const monthKey = formatMonthKey(date)
          if (!monthCounts.has(monthKey)) continue
          existingMonthCounts.set(monthKey, (existingMonthCounts.get(monthKey) ?? 0) + 1)
        }
      }

      for (const [monthKey, requestedCount] of Array.from(monthCounts.entries())) {
        const total = requestedCount + (existingMonthCounts.get(monthKey) ?? 0)
        if (total > 4) {
          return NextResponse.json(
            { error: `Day-Off limit exceeded for ${monthKey}. Each user may only use 4 day-off days per month.` },
            { status: 422 }
          )
        }
      }
    }

    let supportingDocumentUrl: string | null = null
    let supportingDocumentName: string | null = null

    if (supportingDocument instanceof File && supportingDocument.size > 0) {
      const uploadDir = path.join(process.cwd(), "public", "uploads", "attendance", "requests")
      await mkdir(uploadDir, { recursive: true })
      const ext = path.extname(supportingDocument.name) || ""
      const safeName = `request-${session.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
      const bytes = await supportingDocument.arrayBuffer()
      await writeFile(path.join(uploadDir, safeName), Buffer.from(bytes))
      supportingDocumentUrl = `/api/files/attendance/requests/${safeName}`
      supportingDocumentName = supportingDocument.name
    }

    const attendanceRequest = await prisma.attendanceRequest.create({
      data: {
        userId: session.user.id,
        workspaceId: context.workspace.id,
        teamId: primaryAttendanceTeam?.teamId ?? null,
        type: validation.data.type,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        reason: validation.data.reason.trim(),
        supportingDocumentUrl,
        supportingDocumentName,
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
    })

    await logAudit({
      action: "create",
      entityType: "attendance_request",
      entityId: attendanceRequest.id,
      entityName: `${attendanceRequest.type}:${context.user?.name ?? session.user.id}`,
      userId: session.user.id,
      request,
      metadata: {
        type: attendanceRequest.type,
        startDate: attendanceRequest.startDate.toISOString(),
        endDate: attendanceRequest.endDate.toISOString(),
        teamId: attendanceRequest.teamId,
      },
    })

    return NextResponse.json({ request: serializeAttendanceRequest(attendanceRequest) }, { status: 201 })
  } catch (error) {
    console.error("Error creating attendance request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
