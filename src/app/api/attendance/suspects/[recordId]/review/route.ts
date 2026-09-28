export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { formatAttendanceDateKey, getAttendanceWorkspaceContext } from "@/lib/attendance"
import { processAbsenceDeductions } from "@/lib/attendance-absence"
import { createInAppNotification } from "@/lib/notification-service"
import { placeLabel } from "@/lib/attendance-place"
import { recordLevel, recordSides } from "@/lib/attendance-suspect"

/**
 * POST /api/attendance/suspects/:recordId/review  { verdict: "VALID" | "INVALID", note }
 * BoD / One Above All only.
 *
 *   VALID   — the flag was looked at and the check stands. Any flagged record.
 *   INVALID — a fake location: the day becomes TK. Only for level FAKE (the OS said "simulated", or
 *             > 900 km/h) — a weak signal is never enough (owner, 28 Sep 2026). Note required.
 *             The record and its trail are kept in the review's snapshot, then the record is deleted
 *             and the usual absence rule runs for that person and day (remaining day-off quota
 *             first, then TK and −150 XP; holidays, outages, rest days and waivers still excuse it).
 *             The person is told. Undo = BoD "Change status" on the board, as for any TK.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    const ctx = await getAttendanceWorkspaceContext(session.user.id)
    if (!ctx.workspace) return NextResponse.json({ error: "No workspace membership found", code: "NO_WORKSPACE" }, { status: 404 })
    if (!ctx.canManageAttendance) {
      return NextResponse.json({ error: "Hanya BoD ke atas yang bisa meninjau absen mencurigakan.", code: "FORBIDDEN" }, { status: 403 })
    }
    const workspaceId = ctx.workspace.id
    const { recordId } = await params
    const body = (await req.json().catch(() => null)) as { verdict?: string; note?: string } | null
    const verdict = String(body?.verdict ?? "").toUpperCase()
    const note = String(body?.note ?? "").trim()
    if (verdict !== "VALID" && verdict !== "INVALID") {
      return NextResponse.json({ error: "verdict harus VALID atau INVALID.", code: "VALIDATION" }, { status: 400 })
    }
    if (note.length > 300) return NextResponse.json({ error: "Catatan maksimal 300 karakter.", code: "VALIDATION" }, { status: 400 })

    const existing = await prisma.attendanceSuspectReview.findUnique({ where: { recordId } })
    if (existing?.verdict === "INVALID") {
      return NextResponse.json({ error: "Absen ini sudah dinyatakan tidak sah.", code: "ALREADY_INVALID" }, { status: 409 })
    }
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        officeLocation: { select: { name: true, radiusMeters: true } },
        locationPoints: { orderBy: { at: "asc" }, select: { lat: true, lng: true, accuracy: true, at: true, event: true, inside: true } },
      },
    })
    if (!record || record.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Absen tidak ditemukan.", code: "NOT_FOUND" }, { status: 404 })
    }
    const { checkIn, checkOut } = recordSides(record)
    const level = recordLevel([checkIn, checkOut])
    if (!level) return NextResponse.json({ error: "Absen ini tidak ditandai mencurigakan.", code: "NOT_FLAGGED" }, { status: 400 })
    if (verdict === "INVALID" && level !== "FAKE") {
      return NextResponse.json({
        error: level === "NOFACE"
          ? "Tidak sah hanya untuk bukti fake GPS. Selfie tanpa wajah bukan bukti lokasi palsu — kirim peringatan saja (Send warning)."
          : "Tidak sah hanya untuk bukti fake GPS (HP melaporkan lokasi palsu, atau perpindahan mustahil). Tanda ini lemah — bisa lokasi tersimpan (cache) atau HP yang tidak bergerak.",
        code: "NOT_PROOF",
      }, { status: 422 })
    }
    if (verdict === "INVALID" && note.length < 3) {
      return NextResponse.json({ error: "Tulis alasannya (minimal 3 karakter) — orangnya akan membaca ini.", code: "NOTE_REQUIRED" }, { status: 400 })
    }
    const dateKey = formatAttendanceDateKey(record.attendanceDate)
    const item = {
      recordId: record.id, date: dateKey, state: "invalid", level,
      user: { id: record.user.id, name: record.user.name, image: record.user.avatar },
      place: placeLabel(record), checkIn, checkOut, review: null,
    }

    if (verdict === "VALID") {
      await prisma.attendanceSuspectReview.upsert({
        where: { recordId },
        create: { workspaceId, userId: record.userId, recordId, attendanceDate: record.attendanceDate, verdict, note: note || null, reviewedById: session.user.id, snapshot: { item } },
        update: { verdict, note: note || null, reviewedById: session.user.id, reviewedAt: new Date(), snapshot: { item } },
      })
    } else {
      // Evidence first, in the same transaction as the delete: the record with every column, and
      // its trail (deleted with it by the cascade).
      const { locationPoints, user: _u, officeLocation: _o, ...row } = record
      await prisma.$transaction([
        prisma.attendanceSuspectReview.upsert({
          where: { recordId },
          create: {
            workspaceId, userId: record.userId, recordId, attendanceDate: record.attendanceDate, verdict, note, reviewedById: session.user.id,
            snapshot: JSON.parse(JSON.stringify({ item, record: row, trail: locationPoints })),
          },
          update: {
            verdict, note, reviewedById: session.user.id, reviewedAt: new Date(),
            snapshot: JSON.parse(JSON.stringify({ item, record: row, trail: locationPoints })),
          },
        }),
        prisma.attendanceRecord.delete({ where: { id: recordId } }),
      ])
      // The normal absence rule for that one person and day. Today is never processed (the day is
      // not over); the nightly cron takes it tomorrow, within its lookback.
      try {
        await processAbsenceDeductions({ from: record.attendanceDate, to: record.attendanceDate, backfill: true, userIds: [record.userId] })
      } catch (e) {
        console.error("[suspects] absence rule failed after an INVALID verdict", e)
      }
      const d = record.attendanceDate
      const label = `${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][d.getUTCMonth()]}`
      createInAppNotification({
        userId: record.userId,
        type: "attendance_invalid",
        title: `Absen ${label} dinyatakan tidak sah`,
        message: `BoD meninjau absenmu tanggal ${label}: lokasinya terdeteksi palsu (fake GPS), jadi hari itu dihitung TK. Catatan: ${note}`,
        link: "/attendance",
        push: true,
      }).catch((e) => console.error("[suspects] notify failed", e))
    }

    try {
      await logAudit({
        action: "update",
        entityType: "attendance_suspect_review",
        entityId: recordId,
        entityName: `attendance:${record.user.name ?? record.userId}:${dateKey}`,
        userId: session.user.id,
        request: req,
        metadata: { verdict, note: note || null, level, targetUserId: record.userId, date: dateKey },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({ ok: true, recordId, verdict, date: dateKey })
  } catch (error) {
    console.error("Error reviewing suspect attendance:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
