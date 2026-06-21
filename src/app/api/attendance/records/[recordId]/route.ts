export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import {
  buildAttendanceDerivedFields,
  deriveAttendanceStatus,
  formatAttendanceDateKey,
  getAttendanceWorkspaceContext,
  haversineDistanceMeters,
  isAttendanceSilentCorrectionAdmin,
  resolveEffectiveAttendanceShift,
  serializeAttendanceRecord,
} from "@/lib/attendance"
import { cancelAttendancePenaltiesForDate, grantAttendanceWaiver } from "@/lib/attendance-absence"
import { isHoliday } from "@/lib/holidays"
import { attendanceCorrectionSchema, validateBody } from "@/lib/validations"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace || !context.canManageAttendance) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const isSilentAdmin = isAttendanceSilentCorrectionAdmin(context.user?.email)

    const { recordId } = await params
    const body = await request.json()
    const validation = validateBody(attendanceCorrectionSchema, body)
    if (!validation.success) return validation.error

    if (!isSilentAdmin && !validation.data.correctionReason?.trim()) {
      return NextResponse.json({ error: "Correction reason is required." }, { status: 400 })
    }

    const existingRecord = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        officeLocation: true,
      },
    })

    if (!existingRecord || existingRecord.workspaceId !== context.workspace.id) {
      return NextResponse.json({ error: "Attendance record not found" }, { status: 404 })
    }

    let office = existingRecord.officeLocation
    if (validation.data.officeLocationId && validation.data.officeLocationId !== existingRecord.officeLocationId) {
      const nextOffice = await prisma.officeLocation.findUnique({
        where: { id: validation.data.officeLocationId },
      })

      if (!nextOffice || nextOffice.workspaceId !== context.workspace.id) {
        return NextResponse.json({ error: "Office location not found" }, { status: 404 })
      }

      office = nextOffice
    }

    const nextCheckInAt =
      validation.data.checkInAt !== undefined
        ? validation.data.checkInAt
          ? new Date(validation.data.checkInAt)
          : null
        : existingRecord.checkInAt
    const nextCheckOutAt =
      validation.data.checkOutAt !== undefined
        ? validation.data.checkOutAt
          ? new Date(validation.data.checkOutAt)
          : null
        : existingRecord.checkOutAt

    if (!nextCheckInAt) {
      return NextResponse.json({ error: "Check-in time is required for attendance records." }, { status: 400 })
    }

    if (nextCheckOutAt && nextCheckOutAt < nextCheckInAt) {
      return NextResponse.json({ error: "Check-out time cannot be earlier than check-in time." }, { status: 400 })
    }

    const effectiveShift = await resolveEffectiveAttendanceShift({
      userId: existingRecord.userId,
      workspaceId: context.workspace.id,
      office,
      date: existingRecord.attendanceDate, // resolve the shift for the record's own day
    })

    const derived = buildAttendanceDerivedFields({
      attendanceDate: existingRecord.attendanceDate,
      checkInAt: nextCheckInAt,
      checkOutAt: nextCheckOutAt,
      office,
      effectiveShift,
      treatAsNonWorkday: await isHoliday(context.workspace.id, existingRecord.attendanceDate),
    })

    const nextCheckInDistance =
      existingRecord.checkInLat !== null && existingRecord.checkInLng !== null
        ? Number(
            haversineDistanceMeters(
              existingRecord.checkInLat,
              existingRecord.checkInLng,
              office.latitude,
              office.longitude
            ).toFixed(2)
          )
        : existingRecord.checkInDistanceMeters

    const nextCheckOutDistance =
      existingRecord.checkOutLat !== null && existingRecord.checkOutLng !== null
        ? Number(
            haversineDistanceMeters(
              existingRecord.checkOutLat,
              existingRecord.checkOutLng,
              office.latitude,
              office.longitude
            ).toFixed(2)
          )
        : existingRecord.checkOutDistanceMeters

    const updatedRecord = await prisma.attendanceRecord.update({
      where: { id: existingRecord.id },
      data: {
        officeLocationId: office.id,
        checkInAt: nextCheckInAt,
        checkOutAt: nextCheckOutAt,
        notes:
          validation.data.notes !== undefined
            ? validation.data.notes?.trim() || null
            : existingRecord.notes,
        status: deriveAttendanceStatus(nextCheckInAt, nextCheckOutAt),
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
        correctedAt: isSilentAdmin ? null : new Date(),
        correctedById: isSilentAdmin ? null : session.user.id,
        correctionReason: isSilentAdmin ? null : validation.data.correctionReason?.trim() || null,
        checkInDistanceMeters: nextCheckInDistance,
        checkOutDistanceMeters: nextCheckOutDistance,
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

    if (!isSilentAdmin) {
      await logAudit({
        action: "update",
        entityType: "attendance_record",
        entityId: updatedRecord.id,
        entityName: `${updatedRecord.user.name} attendance correction`,
        userId: session.user.id,
        request,
        metadata: {
          correctionReason: validation.data.correctionReason,
          officeLocationId: updatedRecord.officeLocationId,
          status: updatedRecord.status,
        },
      })
    }

    return NextResponse.json({ record: serializeAttendanceRecord(updatedRecord) })
  } catch (error) {
    console.error("Error correcting attendance record:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * BoD cleanup for bad attendance data (e.g. an accidental/"mabok" double check-in, or a mis-tapped
 * check-out). `?part=checkout` clears ONLY the check-out (reopens the record → CHECKED_IN); no `part`
 * deletes the whole record and waives the day so the nightly cron won't re-derive an absence on it.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace || !context.canManageAttendance) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { recordId } = await params
    const url = new URL(request.url)
    const part = url.searchParams.get("part") // "checkout" → reopen; otherwise delete the whole record
    const reason = (url.searchParams.get("reason") || "").trim() || null

    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
    })
    if (!record || record.workspaceId !== context.workspace.id) {
      return NextResponse.json({ error: "Attendance record not found" }, { status: 404 })
    }

    // Clear ONLY the check-out (reopen): keep the check-in, wipe every check-out field → CHECKED_IN.
    if (part === "checkout") {
      if (!record.checkOutAt) {
        return NextResponse.json({ error: "Record ini belum ada check-out-nya." }, { status: 400 })
      }
      const updated = await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          checkOutAt: null,
          status: "CHECKED_IN",
          checkOutStatus: null,
          earlyLeaveMinutes: 0,
          workedMinutes: 0,
          checkOutLat: null,
          checkOutLng: null,
          checkOutAddress: null,
          checkOutPhotoUrl: null,
          checkOutDistanceMeters: null,
          checkOutOffsite: false,
          checkOutApproval: null,
          checkOutReason: null,
          checkOutApprovedById: null,
          checkOutApprovedAt: null,
          correctedAt: new Date(),
          correctedById: session.user.id,
          correctionReason: reason ?? record.correctionReason,
        },
        include: {
          officeLocation: true,
          user: { select: { id: true, name: true, email: true, avatar: true } },
          correctedBy: { select: { id: true, name: true, email: true } },
        },
      })
      await logAudit({
        action: "update",
        entityType: "attendance_record",
        entityId: updated.id,
        entityName: `${updated.user.name} — hapus check-out`,
        userId: session.user.id,
        request,
        metadata: { part: "checkout", reason },
      })
      return NextResponse.json({ record: serializeAttendanceRecord(updated) })
    }

    // Delete the whole record. Refund the day's penalties + waive it so the nightly absence cron doesn't
    // turn the now-empty day into an alpha (−XP + auto day-off).
    const dateKey = formatAttendanceDateKey(record.attendanceDate)
    await prisma.attendanceRecord.delete({ where: { id: record.id } })
    try {
      await cancelAttendancePenaltiesForDate(record.userId, context.workspace.id, record.attendanceDate, dateKey)
      await grantAttendanceWaiver(record.userId, dateKey)
    } catch (err) {
      console.error("DELETE attendance record: penalty cleanup failed:", err)
    }
    await logAudit({
      action: "delete",
      entityType: "attendance_record",
      entityId: record.id,
      entityName: `${record.user.name} — hapus absen ${dateKey}`,
      userId: session.user.id,
      request,
      metadata: { date: dateKey, reason },
    })
    return NextResponse.json({ deleted: true, date: dateKey })
  } catch (error) {
    console.error("Error deleting attendance record:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
