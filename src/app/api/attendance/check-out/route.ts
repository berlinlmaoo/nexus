export const dynamic = "force-dynamic"

import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import {
  buildAttendanceDerivedFields,
  formatAttendanceDateKey,
  getAttendanceWorkspaceContext,
  isWorkdayForAttendanceDate,
  resolveEffectiveAttendanceShift,
  resolveNearestOffice,
  resolveShiftWindowAt,
  serializeAttendanceRecord,
} from "@/lib/attendance"
import { isHoliday } from "@/lib/holidays"
import { isAutoDeduction, hasAttendanceWaiver } from "@/lib/attendance-absence"
import { awardXpOnce } from "@/lib/gamification"
import { reverseGeocodeCoordinates } from "@/lib/reverse-geocode"
import { attendanceActionSchema } from "@/lib/validations"
import { notifyOffsiteCheckoutPending } from "@/lib/notification-service"

const MAX_SELFIE_SIZE = 10 * 1024 * 1024

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const formData = await request.formData()
    const selfie = formData.get("selfie")
    const lat = Number(formData.get("lat"))
    const lng = Number(formData.get("lng"))
    const notes = (formData.get("notes") as string | null)?.trim() || undefined
    // Offsite checkout: staff outside the geofence opting to check out anyway (meeting/shoot), with a
    // mandatory reason. Recorded as PENDING until a BoD approves it.
    const offsiteRequested = formData.get("offsite") === "1" || formData.get("offsite") === "true"
    const offsiteReason = (formData.get("reason") as string | null)?.trim().slice(0, 500) || undefined

    const validation = attendanceActionSchema.safeParse({ lat, lng, notes })
    if (!validation.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    if (!(selfie instanceof File)) {
      return NextResponse.json({ error: "Selfie photo is required." }, { status: 400 })
    }

    if (selfie.size <= 0 || selfie.size > MAX_SELFIE_SIZE) {
      return NextResponse.json({ error: "Selfie photo must be smaller than 10MB." }, { status: 400 })
    }

    // Close the oldest still-open record first — that's either today's check-in,
    // or a previous day the user forgot to check out (must be closed before a new check-in).
    const existingRecord = await prisma.attendanceRecord.findFirst({
      where: {
        userId: session.user.id,
        workspaceId: context.workspace.id,
        status: "CHECKED_IN",
        checkOutAt: null,
      },
      orderBy: { attendanceDate: "asc" },
      include: {
        officeLocation: true,
      },
    })

    if (!existingRecord?.checkInAt) {
      return NextResponse.json({ error: "Check-in is required before check-out." }, { status: 400 })
    }

    const attendanceDate = existingRecord.attendanceDate

    // A REAL leave/day-off covering this date blocks completing attendance. But the cron's own
    // auto-deduction day-off (e.g. ">120 min late → −1 token", filed for a day the staff WAS present)
    // must NOT block them from finishing their check-out — that was the "can't check out, already a
    // day-off" bug. So ignore auto-deductions here.
    const coveringRequests = await prisma.attendanceRequest.findMany({
      where: {
        userId: session.user.id,
        workspaceId: context.workspace.id,
        status: "APPROVED",
        startDate: { lte: attendanceDate },
        endDate: { gte: attendanceDate },
      },
      select: {
        type: true,
        reason: true,
        reviewedById: true,
        approvalSource: true,
      },
    })

    const blockingRequest = coveringRequests.find((r) => !isAutoDeduction(r))
    if (blockingRequest) {
      return NextResponse.json(
        { error: `Attendance cannot be completed because an approved ${blockingRequest.type.toLowerCase().replace("_", "-")} request already covers ${attendanceDate.toISOString().slice(0, 10)}.` },
        { status: 409 }
      )
    }

    const activeOffices = await prisma.officeLocation.findMany({
      where: {
        workspaceId: context.workspace.id,
        isActive: true,
      },
    })

    if (activeOffices.length === 0) {
      return NextResponse.json({ error: "No active office location configured for this workspace." }, { status: 400 })
    }

    const nearest = resolveNearestOffice(activeOffices, validation.data.lat, validation.data.lng)
    if (!nearest) {
      return NextResponse.json({ error: "No office location could be matched." }, { status: 400 })
    }

    const outsideRadius = nearest.distanceMeters > nearest.office.radiusMeters
    if (outsideRadius && !offsiteRequested) {
      // First attempt from outside → tell the client to offer an offsite checkout (with a reason).
      return NextResponse.json(
        {
          error: `You're outside the allowed attendance radius for ${nearest.office.name}.`,
          code: "OUTSIDE_RADIUS",
          officeName: nearest.office.name,
          distanceMeters: Number(nearest.distanceMeters.toFixed(2)),
          radiusMeters: nearest.office.radiusMeters,
        },
        { status: 422 }
      )
    }
    if (outsideRadius && offsiteRequested && !offsiteReason) {
      return NextResponse.json({ error: "Alasan checkout di luar area wajib diisi." }, { status: 400 })
    }
    // Mark as offsite only when genuinely outside the radius (an in-radius checkout is never offsite).
    const isOffsite = outsideRadius && offsiteRequested

    const uploadDir = path.join(process.cwd(), "public", "uploads", "attendance")
    await mkdir(uploadDir, { recursive: true })
    const ext = path.extname(selfie.name) || ".jpg"
    const safeName = `checkout-${session.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const bytes = await selfie.arrayBuffer()
    await writeFile(path.join(uploadDir, safeName), Buffer.from(bytes))
    const photoUrl = `/api/files/attendance/${safeName}`
    const reverseGeocode = await reverseGeocodeCoordinates(validation.data.lat, validation.data.lng)

    const mergedNotes = notes
      ? existingRecord.notes
        ? `${existingRecord.notes}\nCheckout: ${notes}`
        : `Checkout: ${notes}`
      : existingRecord.notes

    const checkOutAt = new Date()
    const effectiveShift = await resolveEffectiveAttendanceShift({
      userId: session.user.id,
      workspaceId: context.workspace.id,
      office: nearest.office,
      date: attendanceDate, // resolve the shift for the day the record belongs to
    })

    const derived = buildAttendanceDerivedFields({
      attendanceDate,
      checkInAt: existingRecord.checkInAt,
      checkOutAt,
      office: nearest.office,
      effectiveShift,
      treatAsNonWorkday: await isHoliday(context.workspace.id, attendanceDate),
    })

    const record = await prisma.attendanceRecord.update({
      where: { id: existingRecord.id },
      data: {
        officeLocationId: nearest.office.id,
        checkOutAt,
        effectiveShiftSource: derived.effectiveShiftSource,
        effectiveTeamId: derived.effectiveTeamId,
        effectiveTeamName: derived.effectiveTeamName,
        effectiveShiftStartTime: derived.effectiveShiftStartTime,
        effectiveShiftEndTime: derived.effectiveShiftEndTime,
        checkInStatus: derived.checkInStatus,
        checkOutStatus: derived.checkOutStatus,
        lateMinutes: derived.lateMinutes,
        earlyLeaveMinutes: derived.earlyLeaveMinutes,
        workedMinutes: derived.workedMinutes,
        checkOutLat: validation.data.lat,
        checkOutLng: validation.data.lng,
        checkOutAddress: reverseGeocode.displayName,
        checkOutPhotoUrl: photoUrl,
        checkOutDistanceMeters: Number(nearest.distanceMeters.toFixed(2)),
        checkOutOffsite: isOffsite,
        checkOutApproval: isOffsite ? "PENDING" : null,
        checkOutReason: isOffsite ? offsiteReason : null,
        notes: mergedNotes,
        status: derived.status,
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
    })

    // "Lupa check-out" penalty — moved here from the nightly 02:00 cron (which nicked staff who were still
    // working overtime). The record counts as forgotten only if it's finally closed ≥24h after the shift
    // STARTED — i.e. not until the next day's shift came around (they came back, got force-blocked, and
    // closed yesterday to check in). This works the same for day shifts AND ones that cross midnight: a
    // same-day check-out — however late (lembur/overtime) — is always <24h from the shift start, so it's
    // never penalized. Skips non-workdays / holidays + days a BoD already pardoned. Best-effort.
    try {
      const { shiftStartAt } = resolveShiftWindowAt(attendanceDate, nearest.office, effectiveShift)
      const forgotten = checkOutAt.getTime() >= shiftStartAt.getTime() + 24 * 60 * 60 * 1000
      if (
        forgotten &&
        isWorkdayForAttendanceDate(attendanceDate, nearest.office) &&
        !(await isHoliday(context.workspace.id, attendanceDate))
      ) {
        const dateKey = formatAttendanceDateKey(attendanceDate)
        if (!(await hasAttendanceWaiver(session.user.id, dateKey))) {
          await awardXpOnce(session.user.id, -25, `attendance:nocheckout:${dateKey}`)
        }
      }
    } catch {
      // XP best-effort; never block the check-out itself.
    }

    await logAudit({
      action: "update",
      entityType: "attendance_record",
      entityId: record.id,
      entityName: `${context.user?.name ?? "User"} check-out`,
      userId: session.user.id,
      request,
      metadata: {
        officeLocationId: nearest.office.id,
        distanceMeters: record.checkOutDistanceMeters,
        offsite: isOffsite,
      },
    })

    // Ping the BoD (best-effort, non-blocking) so they can approve without opening the attendance page.
    if (isOffsite) {
      notifyOffsiteCheckoutPending({
        workspaceId: context.workspace.id,
        staffUserId: session.user.id,
        staffName: context.user?.name ?? "Staff",
        reason: offsiteReason ?? null,
      }).catch((err) => console.error("offsite checkout notify failed:", err))
    }

    return NextResponse.json({ record: serializeAttendanceRecord(record), pendingApproval: isOffsite })
  } catch (error) {
    console.error("Error checking out attendance:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
