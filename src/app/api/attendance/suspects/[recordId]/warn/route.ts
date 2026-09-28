export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { formatAttendanceDateKey, getAttendanceWorkspaceContext } from "@/lib/attendance"
import { notifyAnnouncement } from "@/lib/notification-service"
import { recordLevel, recordSides } from "@/lib/attendance-suspect"

/**
 * POST /api/attendance/suspects/:recordId/warn  { message }   BoD / One Above All only.
 *
 * Absen Monitor's "Send warning…": a personal pop-up + push for the person whose attendance this is,
 * e.g. "your check-in selfie on 27 Sep doesn't show your face". Nothing about the day changes — no TK,
 * no XP; that is what the review route is for, and only with proof.
 *
 * The message goes out as an Announcement (kind "warning", tone "warning", targeted at that one
 * person, title "Attendance warning", imageUrl = the offending selfie), through the same delivery as
 * any Control Room announcement, so every app that already shows announcements shows this too. An
 * AttendanceWarning row keeps the history on the card, even if the announcement is later deleted.
 *
 * → 201 { ok: true, announcementId }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    const ctx = await getAttendanceWorkspaceContext(session.user.id)
    if (!ctx.workspace) return NextResponse.json({ error: "No workspace membership found", code: "NO_WORKSPACE" }, { status: 404 })
    if (!ctx.canManageAttendance) {
      return NextResponse.json({ error: "Hanya BoD ke atas yang bisa mengirim peringatan absen.", code: "FORBIDDEN" }, { status: 403 })
    }
    const workspaceId = ctx.workspace.id
    const { recordId } = await params
    const body = (await req.json().catch(() => null)) as { message?: unknown } | null
    const message = typeof body?.message === "string" ? body.message.trim() : ""
    if (message.length < 3 || message.length > 500) {
      return NextResponse.json({ error: "Pesan peringatan 3–500 karakter.", code: "VALIDATION" }, { status: 400 })
    }

    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { user: { select: { id: true, name: true } } },
    })
    // Scoped to the caller's attendance workspace, like the review route: a BoD of one workspace
    // cannot reach another's records by id.
    if (!record || record.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Absen tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    }
    const { checkIn, checkOut } = recordSides(record)
    const level = recordLevel([checkIn, checkOut])

    // The selfie the warning is about: the one with no face for NOFACE, else the side that carries
    // the record's level, else whichever selfie exists.
    const sides = [checkIn, checkOut]
    const offending =
      (level === "NOFACE" ? sides.find((s) => s?.faceCount === 0) : sides.find((s) => s?.level === level && s?.photoUrl)) ??
      sides.find((s) => s?.photoUrl)
    const imageUrl = offending?.photoUrl ?? null

    const announcement = await prisma.announcement.create({
      data: {
        title: "Attendance warning",
        body: message,
        tone: "warning",
        kind: "warning",
        active: true,
        targetUserIds: [record.userId],
        imageUrl,
        createdById: session.user.id,
      },
    })
    await prisma.attendanceWarning.create({
      data: {
        workspaceId, recordId, userId: record.userId, attendanceDate: record.attendanceDate,
        level, message, announcementId: announcement.id, createdById: session.user.id,
      },
    })
    // Awaited like a Control Room post: the BoD is told "sent", so it should have gone. A push
    // outage must not undo a warning that is already saved (the pop-up still shows it).
    try {
      await notifyAnnouncement(announcement.id)
    } catch (e) {
      console.error("[suspects] warning push failed", e)
    }

    const dateKey = formatAttendanceDateKey(record.attendanceDate)
    try {
      await logAudit({
        action: "create",
        entityType: "attendance_warning",
        entityId: recordId,
        entityName: `attendance:${record.user.name ?? record.userId}:${dateKey}`,
        userId: session.user.id,
        request: req,
        metadata: { level, targetUserId: record.userId, date: dateKey, announcementId: announcement.id },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({ ok: true, announcementId: announcement.id }, { status: 201 })
  } catch (error) {
    console.error("Error sending attendance warning:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
