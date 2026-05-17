export const dynamic = "force-dynamic"

import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import {
  buildAttendanceDerivedFields,
  getAttendanceDate,
  getAttendanceWorkspaceContext,
  markPreviousOpenAttendanceIncomplete,
  resolveNearestOffice,
  resolveEffectiveAttendanceShift,
  serializeAttendanceRecord,
} from "@/lib/attendance"
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

    const formData = await request.formData()
    const selfie = formData.get("selfie")
    const lat = Number(formData.get("lat"))
    const lng = Number(formData.get("lng"))
    const notes = (formData.get("notes") as string | null)?.trim() || undefined

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

    if (nearest.distanceMeters > nearest.office.radiusMeters) {
      return buildOutsideGeofenceResponse()(
        nearest.office.name,
        Number(nearest.distanceMeters.toFixed(2)),
        nearest.office.radiusMeters
      )
    }

    const attendanceDate = getAttendanceDate()
    const approvedRequest = await prisma.attendanceRequest.findFirst({
      where: {
        userId: session.user.id,
        workspaceId: context.workspace.id,
        status: "APPROVED",
        startDate: { lte: attendanceDate },
        endDate: { gte: attendanceDate },
      },
      select: {
        type: true,
      },
    })

    if (approvedRequest) {
      return NextResponse.json(
        { error: `Attendance cannot be recorded because an approved ${approvedRequest.type.toLowerCase().replace("_", "-")} request already covers today.` },
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

    await markPreviousOpenAttendanceIncomplete(session.user.id, context.workspace.id, attendanceDate)

    const uploadDir = path.join(process.cwd(), "public", "uploads", "attendance")
    await mkdir(uploadDir, { recursive: true })
    const ext = path.extname(selfie.name) || ".jpg"
    const safeName = `checkin-${session.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const bytes = await selfie.arrayBuffer()
    await writeFile(path.join(uploadDir, safeName), Buffer.from(bytes))
    const photoUrl = `/api/files/attendance/${safeName}`
    const reverseGeocode = await reverseGeocodeCoordinates(validation.data.lat, validation.data.lng)

    const checkInAt = new Date()
    const effectiveShift = await resolveEffectiveAttendanceShift({
      userId: session.user.id,
      workspaceId: context.workspace.id,
      office: nearest.office,
    })

    const derived = buildAttendanceDerivedFields({
      attendanceDate,
      checkInAt,
      checkOutAt: null,
      office: nearest.office,
      effectiveShift,
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
