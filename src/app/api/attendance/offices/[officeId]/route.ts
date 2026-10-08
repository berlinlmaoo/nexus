export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { restorableDelete, restorableSoftDelete } from "@/lib/deletion-snapshot"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { updateOfficeLocationSchema, validateBody } from "@/lib/validations"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ officeId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace || !context.canManageAttendance) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { officeId } = await params
    const body = await request.json()
    const validation = validateBody(updateOfficeLocationSchema, body)
    if (!validation.success) return validation.error

    const existing = await prisma.officeLocation.findUnique({
      where: { id: officeId },
    })

    if (!existing || existing.workspaceId !== context.workspace.id) {
      return NextResponse.json({ error: "Office not found" }, { status: 404 })
    }

    const office = await prisma.officeLocation.update({
      where: { id: officeId },
      data: {
        ...(validation.data.name !== undefined && { name: validation.data.name.trim() }),
        ...(validation.data.address !== undefined && { address: validation.data.address?.trim() || null }),
        ...(validation.data.latitude !== undefined && { latitude: validation.data.latitude }),
        ...(validation.data.longitude !== undefined && { longitude: validation.data.longitude }),
        ...(validation.data.radiusMeters !== undefined && { radiusMeters: validation.data.radiusMeters }),
        ...(validation.data.timezone !== undefined && { timezone: validation.data.timezone.trim() || "Asia/Jakarta" }),
        ...(validation.data.workdays !== undefined && { workdays: validation.data.workdays }),
        ...(validation.data.shiftStartTime !== undefined && { shiftStartTime: validation.data.shiftStartTime }),
        ...(validation.data.shiftEndTime !== undefined && { shiftEndTime: validation.data.shiftEndTime }),
        ...(validation.data.lateGraceMinutes !== undefined && { lateGraceMinutes: validation.data.lateGraceMinutes }),
        ...(validation.data.earlyLeaveGraceMinutes !== undefined && {
          earlyLeaveGraceMinutes: validation.data.earlyLeaveGraceMinutes,
        }),
        ...(validation.data.isActive !== undefined && { isActive: validation.data.isActive }),
      },
    })

    await logAudit({
      action: "update",
      entityType: "attendance_office",
      entityId: office.id,
      entityName: office.name,
      userId: session.user.id,
      request,
      metadata: {
        workspaceId: context.workspace.id,
        address: office.address,
      },
    })

    return NextResponse.json({ office })
  } catch (error) {
    console.error("Error updating attendance office:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Remove an office. Attendance rows point at their office and the relation forbids orphaning them,
// so an office that has ever been checked into cannot be deleted — only switched off — and the
// answer says so with the count, instead of a bare 500 from the database.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ officeId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace || !context.canManageAttendance) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { officeId } = await params
    const existing = await prisma.officeLocation.findUnique({ where: { id: officeId } })
    if (!existing || existing.workspaceId !== context.workspace.id) {
      return NextResponse.json({ error: "Office not found" }, { status: 404 })
    }
    // Attendance rows point at their office, so one that has ever been checked into is ARCHIVED
    // rather than removed: gone from every list and picker, no more check-ins there, while every
    // day already recorded keeps its office name. An office nobody ever used is simply deleted.
    const records = await prisma.attendanceRecord.count({ where: { officeLocationId: officeId } })
    if (records > 0) {
      // Archived: in the audit first, with a copy of the flags so Control Room → Audit can un-archive it.
      await restorableSoftDelete({
        entityType: "attendance_office", entityId: existing.id, entityName: existing.name, workspaceId: context.workspace.id,
        userId: session.user.id, request, metadata: { workspaceId: context.workspace.id, archived: true },
        meta: { open: { type: "attendance_office", id: existing.id } },
        apply: (tx) => tx.officeLocation.update({ where: { id: officeId }, data: { isActive: false, archivedAt: new Date() } }),
      })
    } else {
      // Never used: really deleted, kept first so Control Room → Audit can restore it.
      await restorableDelete({
        entityType: "attendance_office", entityId: existing.id, entityName: existing.name, workspaceId: context.workspace.id,
        userId: session.user.id, request, metadata: { workspaceId: context.workspace.id },
        meta: { open: { type: "attendance_office", id: existing.id } },
        remove: (tx) => tx.officeLocation.delete({ where: { id: officeId } }),
      })
    }
    return NextResponse.json({ ok: true, archived: records > 0, records })
  } catch (error) {
    console.error("Error deleting attendance office:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
