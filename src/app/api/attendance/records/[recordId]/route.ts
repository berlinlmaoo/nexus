export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import {
  buildAttendanceDerivedFields,
  deriveAttendanceStatus,
  getAttendanceWorkspaceContext,
  haversineDistanceMeters,
  isAttendanceSilentCorrectionAdmin,
  resolveEffectiveAttendanceShift,
  serializeAttendanceRecord,
} from "@/lib/attendance"
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
    })

    const derived = buildAttendanceDerivedFields({
      attendanceDate: existingRecord.attendanceDate,
      checkInAt: nextCheckInAt,
      checkOutAt: nextCheckOutAt,
      office,
      effectiveShift,
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
