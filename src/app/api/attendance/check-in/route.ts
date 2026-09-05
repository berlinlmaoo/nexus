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
  getAttendanceDate,
  getAttendanceWorkspaceContext,
  assessLocationIntegrity,
  getMemberNoGeofence,
  resolveNearestOffice,
  resolveEffectiveAttendanceShift,
  serializeAttendanceRecord,
} from "@/lib/attendance"
import { isHoliday } from "@/lib/holidays"
import { setLatePenalty, clearLatePenalty } from "@/lib/gamification"
import { startFloor, isOutageDate, isAutoDeduction, hasAttendanceWaiver } from "@/lib/attendance-absence"
import { reverseGeocodeCoordinates } from "@/lib/reverse-geocode"
import { attendanceActionSchema } from "@/lib/validations"

const MAX_SELFIE_SIZE = 10 * 1024 * 1024

function buildOutsideGeofenceResponse() {
  return (officeName: string, distanceMeters: number, radiusMeters: number) =>
    NextResponse.json(
      {
        error: `You're outside the allowed attendance radius for ${officeName}.`,
        officeName,
        distanceMeters,
        radiusMeters,
      },
      { status: 422 }
    )
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const attendanceDate = getAttendanceDate()

    // Every day must be closed: if a previous day's check-in was never checked out,
    // the user must check out for that day first (fail fast, before requiring a selfie).
    const pendingCheckout = await prisma.attendanceRecord.findFirst({
      where: {
        userId: session.user.id,
        workspaceId: context.workspace.id,
        status: "CHECKED_IN",
        attendanceDate: { lt: attendanceDate },
      },
      orderBy: { attendanceDate: "asc" },
      select: { id: true, attendanceDate: true, checkInAt: true },
    })

    if (pendingCheckout) {
      // They forgot to check out a prior day. We DON'T penalize here — the forced check-out (below, in the
      // check-out route) is where the −25 is decided, so it can tell a genuine miss from late/overnight work.
      return NextResponse.json(
        {
          error: "Kamu belum check-out di hari sebelumnya. Check-out dulu sebelum bisa check-in.",
          code: "PENDING_CHECKOUT",
          pendingCheckout: {
            id: pendingCheckout.id,
            attendanceDate: pendingCheckout.attendanceDate.toISOString(),
            checkInAt: pendingCheckout.checkInAt?.toISOString() ?? null,
          },
        },
        { status: 409 }
      )
    }

    const formData = await request.formData()
    const selfie = formData.get("selfie")
    const lat = Number(formData.get("lat"))
    const lng = Number(formData.get("lng"))
    const notes = (formData.get("notes") as string | null)?.trim() || undefined
    // Offline capture. The app queues a tap when the server is unreachable and replays it later,
    // so these three travel with it: a client-generated id to make the replay idempotent, the
    // device's own clock at the moment of the tap, and the device uptime as a cross-check.
    const clientId = (formData.get("clientId") as string | null)?.trim() || null
    const deviceAtRaw = (formData.get("deviceAt") as string | null)?.trim() || null
    const uptimeSecRaw = Number(formData.get("uptimeSec"))
    // Location integrity signals. Absent from older app builds, so every one is optional.
    const accuracyRaw = Number(formData.get("accuracyM"))
    const altitudeRaw = Number(formData.get("altitudeM"))
    const accuracyM = Number.isFinite(accuracyRaw) ? accuracyRaw : null
    const altitudeM = Number.isFinite(altitudeRaw) ? altitudeRaw : null
    const simulated = String(formData.get("simulated") ?? "") === "1"
    const deviceUptimeSec = Number.isFinite(uptimeSecRaw) && uptimeSecRaw > 0 ? Math.floor(uptimeSecRaw) : null

    // A tap that WAS stored but whose reply never reached the phone gets replayed when the queue
    // drains. Hand back the record that already exists instead of refusing it or checking the
    // same person in twice — the phone cannot tell the difference between "lost on the way out"
    // and "lost on the way back".
    if (clientId) {
      const already = await prisma.attendanceRecord.findUnique({
        where: { checkInClientId: clientId },
        // serializeAttendanceRecord needs both relations; without them this is a type error.
        include: { officeLocation: true, user: true },
      })
      if (already) {
        return NextResponse.json({ record: serializeAttendanceRecord(already), duplicate: true })
      }
    }

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

    // Custom/Mobile members are geofence-exempt — they may check in anywhere. Others are held to the radius.
    const noGeofence = await getMemberNoGeofence(session.user.id, context.workspace.id)
    if (!noGeofence && nearest.distanceMeters > nearest.office.radiusMeters) {
      return buildOutsideGeofenceResponse()(
        nearest.office.name,
        Number(nearest.distanceMeters.toFixed(2)),
        nearest.office.radiusMeters
      )
    }

    // A REAL leave/day-off blocks recording attendance. The cron's auto-deduction day-off (a penalty
    // on a day the staff was present, e.g. ">120 min late") must NOT block them → ignore auto-deductions.
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
        { error: `Attendance cannot be recorded because an approved ${blockingRequest.type.toLowerCase().replace("_", "-")} request already covers today.` },
        { status: 409 }
      )
    }

    const existingRecord = await prisma.attendanceRecord.findUnique({
      where: {
        userId_workspaceId_attendanceDate: {
          userId: session.user.id,
          workspaceId: context.workspace.id,
          attendanceDate,
        },
      },
    })

    if (existingRecord?.checkInAt) {
      return NextResponse.json({ error: "You have already checked in today." }, { status: 409 })
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "attendance")
    await mkdir(uploadDir, { recursive: true })
    const ext = path.extname(selfie.name) || ".jpg"
    const safeName = `checkin-${session.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const bytes = await selfie.arrayBuffer()
    await writeFile(path.join(uploadDir, safeName), Buffer.from(bytes))
    const photoUrl = `/api/files/attendance/${safeName}`
    const reverseGeocode = await reverseGeocodeCoordinates(validation.data.lat, validation.data.lng)

    // A replayed tap is recorded at the moment the person actually tapped, not when the queue
    // finally drained — otherwise a 09:00 check-in that syncs at 11:00 is stored as two hours
    // late, which punishes someone for the server being down.
    //
    // That time comes from the device, so it is not trusted blindly: it may not be in the future
    // and may not be older than a week. Outside that window the server's own clock is used
    // instead. Either way the record is flagged as offline, because a device clock can be moved
    // and whoever reviews attendance has to be able to see that.
    const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
    const serverNow = new Date()
    const claimed = deviceAtRaw ? new Date(deviceAtRaw) : null
    const claimedUsable =
      claimed !== null &&
      !Number.isNaN(claimed.getTime()) &&
      claimed <= serverNow &&
      serverNow.getTime() - claimed.getTime() <= OFFLINE_MAX_AGE_MS
    const checkInAt = claimedUsable ? (claimed as Date) : serverNow
    const checkInOffline = deviceAtRaw !== null
    const effectiveShift = await resolveEffectiveAttendanceShift({
      userId: session.user.id,
      workspaceId: context.workspace.id,
      office: nearest.office,
      date: attendanceDate, // weekday of today selects any per-day shift override
    })

    const holidayToday = await isHoliday(context.workspace.id, attendanceDate)
    const derived = buildAttendanceDerivedFields({
      attendanceDate,
      checkInAt,
      checkOutAt: null,
      office: nearest.office,
      effectiveShift,
      treatAsNonWorkday: holidayToday, // tanggal merah → no late penalty
    })

    const integrity = await assessLocationIntegrity({
      userId: session.user.id,
      workspaceId: context.workspace.id,
      lat: validation.data.lat,
      lng: validation.data.lng,
      at: checkInAt,
      simulated,
    })

    const record = await prisma.attendanceRecord.create({
      data: {
        userId: session.user.id,
        workspaceId: context.workspace.id,
        officeLocationId: nearest.office.id,
        attendanceDate,
        checkInAt,
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
        attendanceFlexi: derived.attendanceFlexi,
        checkInOffline,
        checkInAccuracyM: accuracyM,
        checkInAltitudeM: altitudeM,
        checkInSimulated: simulated,
        checkInSuspect: integrity.suspect,
        checkInSuspectReason: integrity.reason,
        checkInImpliedKmh: integrity.impliedKmh,
        checkInDeviceUptimeSec: checkInOffline ? deviceUptimeSec : null,
        checkInClientId: clientId,
        checkInLat: validation.data.lat,
        checkInLng: validation.data.lng,
        checkInAddress: reverseGeocode.displayName,
        checkInPhotoUrl: photoUrl,
        checkInDistanceMeters: Number(nearest.distanceMeters.toFixed(2)),
        notes,
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

    // Finalize the late penalty at the exact check-in lateness: -1 XP/minute (max 120).
    // setLatePenalty overwrites any value the per-minute accrual job set while the user was
    // still late & unchecked-in, freezing it at the real lateness. The nightly cron is a
    // backstop and also handles >120min -> day-off, no-checkout (-25), and alpha (-150).
    // BoD & One Above All are exempt from ALL attendance XP penalties (same as the crons).
    const exemptFromPenalty = context.workspaceRole === "BOD" || context.workspaceRole === "ONE_ABOVE_ALL"
    // No attendance penalty before the policy go-live date (same floor the crons use) — keeps the live
    // check-in path consistent with "penalties start from ABSENCE_DEDUCTION_START_DATE", not today.
    const beforePolicyFloor = attendanceDate.getTime() < startFloor().getTime()
    // System outage day → staff couldn't check in on time through no fault of their own; no late penalty.
    const outageDay = isOutageDate(formatAttendanceDateKey(attendanceDate))
    // BoD pardoned this member-day ("hapus punishment") → no late penalty at check-in either.
    const waived = !exemptFromPenalty && !beforePolicyFloor && !outageDay
      ? await hasAttendanceWaiver(session.user.id, formatAttendanceDateKey(attendanceDate))
      : false
    if (!exemptFromPenalty && !beforePolicyFloor && !outageDay && !waived) {
      try {
        if (derived.lateMinutes && derived.lateMinutes > 0) {
          await setLatePenalty(
            session.user.id,
            formatAttendanceDateKey(attendanceDate),
            -Math.min(derived.lateMinutes, 120)
          )
        } else {
          // Checked in ON TIME (within grace) → refund any penalty the per-minute accrual job may
          // have stacked while we were waiting. Without this, an accrued penalty stayed stranded
          // even though the policy says the user wasn't late (Radja's −6 despite ON_TIME bug).
          await clearLatePenalty(session.user.id, formatAttendanceDateKey(attendanceDate))
        }
      } catch (xpErr) {
        console.error("late XP penalty (check-in) failed:", xpErr)
      }
    }

    await logAudit({
      action: "create",
      entityType: "attendance_record",
      entityId: record.id,
      entityName: `${context.user?.name ?? "User"} check-in`,
      userId: session.user.id,
      request,
      metadata: {
        officeLocationId: nearest.office.id,
        distanceMeters: record.checkInDistanceMeters,
      },
    })

    return NextResponse.json({ record: serializeAttendanceRecord(record) }, { status: 201 })
  } catch (error) {
    console.error("Error checking in attendance:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
