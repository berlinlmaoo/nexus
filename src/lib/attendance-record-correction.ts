import { noteAttendanceChanged } from "@/lib/attendance-broadcast"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
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
import { cancelAttendancePenaltiesForDateDetailed } from "@/lib/attendance-absence"
import { isHoliday } from "@/lib/holidays"
import { attendanceCorrectionSchema, validateBody } from "@/lib/validations"
import type { z } from "zod"
import type { AttendanceRecord, OfficeLocation } from "@/generated/prisma/client"

type CorrectionInput = z.infer<typeof attendanceCorrectionSchema>

/**
 * What a BoD time correction of one record turns it into (office, the two times, the shift-derived status/late/
 * early/worked minutes, the distances), computed and NOT written. The PATCH below writes exactly this; the MCP
 * preview (lib/mcp-attendance.ts) shows exactly this — one computation, so the card can never differ from the write.
 * `{ error, status }` is the PATCH's own refusal.
 */
export async function planAttendanceRecordCorrection(
  existingRecord: AttendanceRecord & { officeLocation: OfficeLocation },
  workspaceId: string,
  data: CorrectionInput,
): Promise<
  | { ok: false; status: number; error: string }
  | {
      ok: true
      office: OfficeLocation
      nextCheckInAt: Date
      nextCheckOutAt: Date | null
      derived: ReturnType<typeof buildAttendanceDerivedFields>
      nextCheckInDistance: number | null
      nextCheckOutDistance: number | null
    }
> {
  let office = existingRecord.officeLocation
  if (data.officeLocationId && data.officeLocationId !== existingRecord.officeLocationId) {
    const nextOffice = await prisma.officeLocation.findUnique({
      where: { id: data.officeLocationId },
    })

    if (!nextOffice || nextOffice.workspaceId !== workspaceId) {
      return { ok: false, status: 404, error: "Office location not found" }
    }

    office = nextOffice
  }

  const nextCheckInAt =
    data.checkInAt !== undefined
      ? data.checkInAt
        ? new Date(data.checkInAt)
        : null
      : existingRecord.checkInAt
  const nextCheckOutAt =
    data.checkOutAt !== undefined
      ? data.checkOutAt
        ? new Date(data.checkOutAt)
        : null
      : existingRecord.checkOutAt

  if (!nextCheckInAt) {
    return { ok: false, status: 400, error: "Check-in time is required for attendance records." }
  }

  if (nextCheckOutAt && nextCheckOutAt < nextCheckInAt) {
    return { ok: false, status: 400, error: "Check-out time cannot be earlier than check-in time." }
  }

  const effectiveShift = await resolveEffectiveAttendanceShift({
    userId: existingRecord.userId,
    workspaceId,
    office,
    date: existingRecord.attendanceDate, // resolve the shift for the record's own day
  })

  const derived = buildAttendanceDerivedFields({
    attendanceDate: existingRecord.attendanceDate,
    checkInAt: nextCheckInAt,
    checkOutAt: nextCheckOutAt,
    office,
    effectiveShift,
    treatAsNonWorkday: await isHoliday(workspaceId, existingRecord.attendanceDate),
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

  return { ok: true, office, nextCheckInAt, nextCheckOutAt, derived, nextCheckInDistance, nextCheckOutDistance }
}

/**
 * BoD correction of one attendance record's times (PATCH /api/attendance/records/[recordId]; moved here verbatim
 * 17 Nov 2026 so the MCP attendance correction runs exactly this code — lib/mcp-attendance.ts).
 * `allowSilent: false` (MCP): a change made through a connected app is always stamped and audited, even for an
 * account in ATTENDANCE_SILENT_CORRECTION_ADMINS. `auditMetadata`: extra keys on the audit row ("via <client> (MCP)").
 */
export async function applyAttendanceRecordCorrection({
  request,
  session,
  recordId,
  body,
  auditMetadata,
  allowSilent = true,
  expect,
}: {
  request: NextRequest
  session: { user: { id: string } }
  recordId: string
  body: unknown
  auditMetadata?: Record<string, unknown>
  allowSilent?: boolean
  /** The two times the change was previewed against (MCP): a record that moved since answers 409 RECORD_CHANGED. */
  expect?: { checkInAt: Date | null; checkOutAt: Date | null }
}): Promise<NextResponse> {
  try {
    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace || !context.canManageAttendance) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const isSilentAdmin = allowSilent && isAttendanceSilentCorrectionAdmin(context.user?.email)

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

    const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null)
    if (expect && (!sameTime(existingRecord.checkInAt, expect.checkInAt) || !sameTime(existingRecord.checkOutAt, expect.checkOutAt))) {
      return NextResponse.json(
        { error: "This attendance record changed after the preview. Preview the correction again.", code: "RECORD_CHANGED" },
        { status: 409 },
      )
    }

    const plan = await planAttendanceRecordCorrection(existingRecord, context.workspace.id, validation.data)
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status })
    const { office, nextCheckInAt, nextCheckOutAt, derived, nextCheckInDistance, nextCheckOutDistance } = plan

    // A correction is the BoD saying "this is what the day really was". Until 20 Sep 2026 that
    // rewrote the record and left the XP ledger where the wrong record had put it: ON_TIME on the
    // board, −N XP still in the score. The ticket-correction path has always refunded ("the XP the
    // day cost has to come back, or the correction is only half done"); this one now does the same
    // when the corrected day is clean — within grace and, if a check-out was written, closed. A day
    // that is still late after the correction keeps its penalty.
    //
    // The record write goes first and is conditional on the record still being what this correction was
    // computed from (race audit M3): a check-out (or another correction) that landed after the read above
    // would otherwise be erased by `nextCheckOutAt = existingRecord.checkOutAt`. Compared on the two
    // times, not updatedAt, because the location trail and the face check touch the row all day long.
    // Losing that race answers 409 and refunds nothing; the refund then follows the write it belongs to.
    const written = await prisma.attendanceRecord.updateMany({
      where: { id: existingRecord.id, checkInAt: existingRecord.checkInAt, checkOutAt: existingRecord.checkOutAt },
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
    })
    if (written.count === 0) {
      return NextResponse.json(
        { error: "This attendance record changed while you were editing it. Reload it and correct it again.", code: "RECORD_CHANGED" },
        { status: 409 },
      )
    }

    let xpRefunded = 0
    if (!isSilentAdmin) {
      const grace = Math.max(0, office.lateGraceMinutes ?? 0)
      const clean = (derived.lateMinutes ?? 0) <= grace && Boolean(nextCheckOutAt)
      if (clean) {
        const dateKey = formatAttendanceDateKey(existingRecord.attendanceDate)
        try {
          // Refund and (when something came back) the waiver in one transaction (race audit H2).
          const undone = await cancelAttendancePenaltiesForDateDetailed(existingRecord.userId, context.workspace.id, existingRecord.attendanceDate, dateKey, { waive: "ifChanged" })
          xpRefunded = undone.xp
        } catch (e) { console.error("correction refund failed:", e) }
      }
    }

    const updatedRecord = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { id: existingRecord.id },
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
          ...(auditMetadata ?? {}),
        },
      })
    }

    noteAttendanceChanged(updatedRecord.userId, "record", updatedRecord.id, updatedRecord.attendanceDate)
    return NextResponse.json({ record: serializeAttendanceRecord(updatedRecord), xpRefunded })
  } catch (error) {
    console.error("Error correcting attendance record:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
