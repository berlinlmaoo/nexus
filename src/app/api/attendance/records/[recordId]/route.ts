export const dynamic = "force-dynamic"

import { noteAttendanceChanged } from "@/lib/attendance-broadcast"
import { pingActorAfter } from "@/lib/attendance-realtime"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { restorableDelete } from "@/lib/deletion-snapshot"
import {
  formatAttendanceDateKey,
  getAttendanceWorkspaceContext,
  serializeAttendanceRecord,
} from "@/lib/attendance"
import { cancelAttendancePenaltiesForDate } from "@/lib/attendance-absence"
import { applyAttendanceRecordCorrection } from "@/lib/attendance-record-correction"

// BoD correction of a record's times — the rules live in lib/attendance-record-correction.ts.
async function handlePATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { recordId } = await params
    const body = await request.json()
    return await applyAttendanceRecordCorrection({ request, session: { user: { id: session.user.id } }, recordId, body })
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
async function handleDELETE(
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
      noteAttendanceChanged(updated.userId, "record", updated.id, updated.attendanceDate)
      return NextResponse.json({ record: serializeAttendanceRecord(updated) })
    }

    // Delete the whole record. Refund the day's penalties + waive it so the nightly absence cron doesn't
    // turn the now-empty day into an alpha (−XP + auto day-off).
    // The record and its location trail are kept first, so Control Room → Audit can restore them. The
    // refund and the waiver below are not undone by a restore (the restore card says so).
    const dateKey = formatAttendanceDateKey(record.attendanceDate)
    await restorableDelete({
      entityType: "attendance_record", entityId: record.id,
      entityName: `${record.user.name ?? "Someone"} · ${dateKey}`,
      workspaceId: context.workspace.id, userId: session.user.id, request,
      metadata: { date: dateKey, reason, targetUserId: record.userId },
      meta: { open: { type: "attendance_record", id: record.id, date: dateKey } },
      remove: (tx) => tx.attendanceRecord.delete({ where: { id: record.id } }),
    })
    try {
      // Refund and waiver in one transaction (race audit H2): the accrual could otherwise re-penalise
      // the emptied day between the two.
      await cancelAttendancePenaltiesForDate(record.userId, context.workspace.id, record.attendanceDate, dateKey, { waive: "always" })
    } catch (err) {
      console.error("DELETE attendance record: penalty cleanup failed:", err)
    }
    noteAttendanceChanged(record.userId, "record", record.id, dateKey)
    return NextResponse.json({ deleted: true, date: dateKey })
  } catch (error) {
    console.error("Error deleting attendance record:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// C-17: the actor's other devices refetch (lib/attendance-realtime.ts).
export const PATCH = pingActorAfter("correction", handlePATCH)
export const DELETE = pingActorAfter("correction", handleDELETE)
