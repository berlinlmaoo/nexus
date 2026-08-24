export const dynamic = "force-dynamic"

import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { notifyApproversOfRequest } from "@/lib/wa-bot"
import {
  attendanceMonthRange,
  attendancePeriodKey,
  attendancePeriodRange,
  endOfAttendanceMonth,
  enumerateAttendanceDates,
  formatAttendanceDateKey,
  getAttendanceWorkspaceContext,
  getPrimaryAttendanceTeam,
  parseDateOnlyToUtc,
  resolveEffectiveAttendanceShift,
  serializeAttendanceRequest,
  startOfAttendanceMonth,
} from "@/lib/attendance"
import { cancelAttendancePenaltiesForRange } from "@/lib/attendance-absence"
import {
  attendanceRequestCreateSchema,
  attendanceRequestQuerySchema,
} from "@/lib/validations"
import { ANNUAL_LEAVE_DAYS, checkLeaveEligibility, leaveDaysInYear, leaveYearRange } from "@/lib/annual-leave"
import { reverseGeocodeCoordinates } from "@/lib/reverse-geocode"
import { isBackdated, reportDelayMinutes } from "@/lib/permit-rules"

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

    // Team-scoped MANAGER: restrict to the members of the team(s) they lead (by userId — robust even
    // when a request's teamId is null). Full managers (BoD/OAA) see everyone.
    const isTeamManager = !context.canManageAttendance && context.teamLeadTeamIds.length > 0
    let teamScopeUserIds: string[] | null = null
    if ((scope === "workspace" || scope === "approvals") && isTeamManager) {
      const teamMembers = await prisma.teamMember.findMany({
        where: { teamId: { in: context.teamLeadTeamIds } },
        select: { userId: true },
      })
      teamScopeUserIds = Array.from(new Set(teamMembers.map((m) => m.userId)))
    }

    if (scope === "me") {
      where.userId = session.user.id
    } else if (teamScopeUserIds) {
      where.userId =
        parsed.data.userId && teamScopeUserIds.includes(parsed.data.userId)
          ? parsed.data.userId
          : { in: teamScopeUserIds }
    } else {
      // Full manager (BoD/OAA): optional narrowing by user/team.
      if (parsed.data.userId) where.userId = parsed.data.userId
      if (parsed.data.teamId) where.teamId = parsed.data.teamId
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
    const targetUserId = String(formData.get("targetUserId") ?? "").trim()
    const supportingDocument = formData.get("supportingDocument")
    // Where the person was when they filed. Same pair check-in already collects.
    const submittedLat = Number(formData.get("lat"))
    const submittedLng = Number(formData.get("lng"))

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

    // Permission model: Staff may self-submit DAY_OFF / SICK / PERMIT / RED_DATE (all go in as
    // PENDING for review). LEAVE is granted by BoD (canManageAttendance) — optionally on behalf
    // of a specific user.
    const canGrant = context.canManageAttendance // BoD / One Above All / system admin
    const reqType = validation.data.type
    // Sick self-requests must include the doctor's note photo (BoD grants are exempt).
    if (!canGrant && reqType === "SICK" && !(supportingDocument instanceof File && supportingDocument.size > 0)) {
      return NextResponse.json({ error: "Request sakit wajib melampirkan foto surat sakit." }, { status: 400 })
    }
    // Izin now demands the same evidence check-in does — photo + coordinates. Without it, izin was
    // strictly cheaper than showing up: no proof, no location, no time.
    if (!canGrant && reqType === "PERMIT") {
      if (!(supportingDocument instanceof File && supportingDocument.size > 0)) {
        return NextResponse.json({ error: "Izin wajib melampirkan foto sebagai bukti." }, { status: 400 })
      }
      if (!Number.isFinite(submittedLat) || !Number.isFinite(submittedLng)) {
        return NextResponse.json(
          { error: "Izin wajib menyertakan lokasi. Aktifin izin lokasi di browser/HP kamu ya." },
          { status: 400 }
        )
      }
      // Today or later only. Yesterday's missed check-in goes through a BoD grant, where a human
      // signs off on it — that's what kills "lupa absen kemarin".
      if (isBackdated(parsedStartDate)) {
        return NextResponse.json(
          { error: "Izin nggak bisa diajukan buat tanggal yang udah lewat. Minta BoD yang input kalau memang perlu.", code: "PERMIT_BACKDATED" },
          { status: 422 }
        )
      }
    }
    let effectiveUserId = session.user.id
    const isGrant = Boolean(targetUserId && targetUserId !== session.user.id)
    if (isGrant) {
      if (!canGrant) {
        return NextResponse.json({ error: "Cuma BoD yang bisa kasih izin ke user lain." }, { status: 403 })
      }
      const targetMembership = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: targetUserId, workspaceId: context.workspace.id } },
        select: { userId: true },
      })
      if (!targetMembership) {
        return NextResponse.json({ error: "User target bukan anggota workspace ini." }, { status: 400 })
      }
      effectiveUserId = targetUserId
    }

    const [existingRequests, existingAttendance, primaryAttendanceTeam] = await Promise.all([
      prisma.attendanceRequest.findMany({
        where: {
          userId: effectiveUserId,
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
          userId: effectiveUserId,
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
      getPrimaryAttendanceTeam(effectiveUserId, context.workspace.id),
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

    // Monthly quota enforcement for the two bucketed leave types: DAY_OFF (per-person override,
    // default 4) and RED_DATE / "tanggal merah" (fixed 2/month). Each counts within its OWN type,
    // so the two buckets are independent. Admin grants (isGrant) bypass the cap.
    if (validation.data.type === "DAY_OFF" || validation.data.type === "RED_DATE") {
      const reqType = validation.data.type
      // DAY_OFF quota resets on the 28→27 payroll period; RED_DATE stays on the calendar month.
      const isDayOff = reqType === "DAY_OFF"
      const keyOf = (d: Date) => (isDayOff ? attendancePeriodKey(formatAttendanceDateKey(d)) : formatMonthKey(d))
      const rangeOf = (mk: string) => (isDayOff ? attendancePeriodRange(mk) : attendanceMonthRange(mk))
      const requestDates = enumerateAttendanceDates(parsedStartDate, parsedEndDate)
      const monthCounts = new Map<string, number>()

      for (const date of requestDates) {
        const monthKey = keyOf(date)
        monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1)
      }

      const monthWindows = Array.from(monthCounts.keys()).map((monthKey) => ({
        monthKey,
        ...rangeOf(monthKey),
      }))

      const existingSameType = await prisma.attendanceRequest.findMany({
        where: {
          userId: effectiveUserId,
          type: reqType,
          status: { in: ["PENDING", "APPROVED"] },
          OR: monthWindows.map((window) => ({
            startDate: { lte: window.end },
            endDate: { gte: window.start },
          })),
        },
        select: { startDate: true, endDate: true },
      })

      const existingMonthCounts = new Map<string, number>()
      for (const requestItem of existingSameType) {
        for (const date of enumerateAttendanceDates(requestItem.startDate, requestItem.endDate)) {
          const monthKey = keyOf(date)
          if (!monthCounts.has(monthKey)) continue
          existingMonthCounts.set(monthKey, (existingMonthCounts.get(monthKey) ?? 0) + 1)
        }
      }

      const label = reqType === "DAY_OFF" ? "day-off" : "tanggal merah"
      // DAY_OFF: per-person override (default 4). RED_DATE: per-month quota set by BoD (default 0
      // until BoD inputs it — so staff can't request tanggal merah until BoD sets the month's jatah).
      let dayOffQuota = 4
      const redQuotaByMonth = new Map<string, number>()
      if (reqType === "DAY_OFF") {
        const quotaMember = await prisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: effectiveUserId, workspaceId: context.workspace.id } },
          select: { dayOffQuota: true },
        })
        dayOffQuota = quotaMember?.dayOffQuota ?? 4
      } else {
        const rows = await prisma.redDateQuota.findMany({
          where: { workspaceId: context.workspace.id, month: { in: Array.from(monthCounts.keys()) } },
          select: { month: true, quota: true },
        })
        for (const r of rows) redQuotaByMonth.set(r.month, r.quota)
      }

      if (!isGrant) {
        for (const [monthKey, requestedCount] of Array.from(monthCounts.entries())) {
          const total = requestedCount + (existingMonthCounts.get(monthKey) ?? 0)
          const quota = reqType === "DAY_OFF" ? dayOffQuota : (redQuotaByMonth.get(monthKey) ?? 0)
          if (total > quota) {
            return NextResponse.json(
              { error: `Jatah ${label} ${monthKey} terlampaui. Maksimal ${quota} hari per bulan${quota === 0 ? " (BoD belum set jatah)" : ""}.` },
              { status: 422 }
            )
          }
        }
      }
    }

    // ── Cuti tahunan ────────────────────────────────────────────────────────────────────────────
    // Staff may now submit LEAVE themselves (it used to be BoD-grant only), gated on two things:
    // 12 months of service, and 12 days per calendar year. Admin grants (isGrant) skip both — a BoD
    // giving someone unpaid or exceptional leave shouldn't be blocked by the annual allowance.
    if (reqType === "LEAVE" && !isGrant) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: effectiveUserId, workspaceId: context.workspace.id } },
        select: { employmentStartDate: true },
      })
      const eligibility = checkLeaveEligibility(member?.employmentStartDate ?? null)
      if (!eligibility.eligible) {
        return NextResponse.json({ error: eligibility.reason, code: "LEAVE_NOT_ELIGIBLE" }, { status: 403 })
      }

      // Charge each calendar year the request touches to that year's own allowance, so a request
      // spanning New Year can't dodge either year's cap.
      const yearsTouched = new Set<number>()
      for (const d of enumerateAttendanceDates(parsedStartDate, parsedEndDate)) yearsTouched.add(d.getUTCFullYear())

      for (const year of Array.from(yearsTouched)) {
        const { start, end } = leaveYearRange(new Date(Date.UTC(year, 5, 1)))
        const existing = await prisma.attendanceRequest.findMany({
          where: {
            userId: effectiveUserId,
            type: "LEAVE",
            status: { in: ["PENDING", "APPROVED"] },
            startDate: { lte: end },
            endDate: { gte: start },
          },
          select: { startDate: true, endDate: true },
        })
        const used = existing.reduce((sum, r) => sum + leaveDaysInYear(r.startDate, r.endDate, year), 0)
        const asking = leaveDaysInYear(parsedStartDate, parsedEndDate, year)
        if (used + asking > ANNUAL_LEAVE_DAYS) {
          const left = Math.max(0, ANNUAL_LEAVE_DAYS - used)
          return NextResponse.json(
            {
              error: `Jatah cuti tahunan ${year} nggak cukup. Sisa ${left} dari ${ANNUAL_LEAVE_DAYS} hari, kamu minta ${asking} hari.`,
              code: "LEAVE_QUOTA_EXCEEDED",
            },
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

    // Evidence recorded on the request itself, so the approver judges from data and not from tone of
    // voice. Only for self-submitted izin — a BoD grant is already a human vouching for it.
    let permitLat: number | null = null
    let permitLng: number | null = null
    let permitAddress: string | null = null
    let permitDelay: number | null = null
    if (!canGrant && reqType === "PERMIT") {
      permitLat = submittedLat
      permitLng = submittedLng
      try {
        const geo = await reverseGeocodeCoordinates(submittedLat, submittedLng)
        permitAddress = geo.displayName ?? null
      } catch {
        // Coordinates are the evidence; the street name is a convenience. A geocoder outage must not
        // stop someone filing izin.
        permitAddress = null
      }
      const office = await prisma.officeLocation.findFirst({
        where: { workspaceId: context.workspace.id, isActive: true },
      })
      if (office) {
        const shift = await resolveEffectiveAttendanceShift({
          userId: effectiveUserId,
          workspaceId: context.workspace.id,
          office,
          date: parsedStartDate,
        })
        permitDelay = reportDelayMinutes(new Date(), parsedStartDate, shift.shiftStartTime)
      }
    }

    const attendanceRequest = await prisma.attendanceRequest.create({
      data: {
        userId: effectiveUserId,
        workspaceId: context.workspace.id,
        teamId: primaryAttendanceTeam?.teamId ?? null,
        type: validation.data.type,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        reason: validation.data.reason.trim(),
        supportingDocumentUrl,
        supportingDocumentName,
        submittedLat: permitLat,
        submittedLng: permitLng,
        submittedAddress: permitAddress,
        reportDelayMinutes: permitDelay,
        // BoD granting on behalf of a user → already approved by that BoD.
        ...(isGrant ? { status: "APPROVED" as const, reviewedById: session.user.id, reviewedAt: new Date() } : {}),
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
      action: isGrant ? "grant" : "create",
      entityType: "attendance_request",
      entityId: attendanceRequest.id,
      entityName: `${attendanceRequest.type}:${attendanceRequest.user?.name ?? effectiveUserId}`,
      userId: session.user.id,
      request,
      metadata: {
        type: attendanceRequest.type,
        startDate: attendanceRequest.startDate.toISOString(),
        endDate: attendanceRequest.endDate.toISOString(),
        teamId: attendanceRequest.teamId,
        granted: isGrant,
        targetUserId: effectiveUserId,
      },
    })

    // Filing an excuse (pending self-submit or admin grant) immediately clears any attendance penalty
    // already applied for the covered days — a window-independent hold. Reject/cancel later re-derives.
    try {
      await cancelAttendancePenaltiesForRange(effectiveUserId, context.workspace.id, attendanceRequest.startDate, attendanceRequest.endDate)
    } catch (err) { console.error("cancelAttendancePenaltiesForRange (file) failed:", err) }

    // Ping approvers on WhatsApp (fire-and-forget) so a BoD can /approve straight from chat.
    if (!isGrant && attendanceRequest.status === "PENDING") {
      notifyApproversOfRequest(attendanceRequest.id).catch((e) => console.error("[wa] notifyApproversOfRequest failed", e))
    }

    return NextResponse.json({ request: serializeAttendanceRequest(attendanceRequest) }, { status: 201 })
  } catch (error) {
    console.error("Error creating attendance request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
