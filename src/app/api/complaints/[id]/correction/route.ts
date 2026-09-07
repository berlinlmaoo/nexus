export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { cancelAttendancePenaltiesForDate, grantAttendanceWaiver } from "@/lib/attendance-absence"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { notifyComplaintReply } from "@/lib/notification-service"
import {
  buildAttendanceDerivedFields,
  formatAttendanceDateKey,
  getAttendanceWorkspaceContext,
  resolveEffectiveAttendanceShift,
  serializeAttendanceRecord,
} from "@/lib/attendance"
import { isHoliday } from "@/lib/holidays"
import { BODY_MAX, isBodPlus } from "@/lib/complaints"
import {
  ATTENDANCE_CORRECTION_INCLUDE, CORRECTION_NOTE_MAX, describeCorrection,
  proposeAttendanceCorrection, serializeAttendanceCorrection, validateCorrectionTimes,
  type CorrectionDecision,
} from "@/lib/attendance-correction"

// Attendance correction proposed on a ticket, decided by a BoD.
//
// THIS FILE IS THE ONLY PLACE A TICKET CAN WRITE AN AttendanceRecord. GIDEON's tool
// (propose_attendance_correction) writes the proposal and nothing else; approval here is the human tap
// that makes it real. Keep it that way — if a second write path shows up, the guarantee is gone.

const eq = (a: Date | null, b: Date | null) => (a ? a.getTime() : null) === (b ? b.getTime() : null)

// GET /api/complaints/[id]/correction — proposals on this ticket. Reporter or BoD, like the thread itself.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: me }, select: { workspaceId: true, role: true } })
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const viewerIsBod = isBodPlus(membership.role)
    const { id } = await params

    const complaint = await prisma.complaint.findUnique({ where: { id }, select: { id: true, workspaceId: true, reporterId: true } })
    if (!complaint || complaint.workspaceId !== membership.workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!viewerIsBod && complaint.reporterId !== me) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const corrections = await prisma.attendanceCorrection.findMany({
      where: { complaintId: id },
      include: ATTENDANCE_CORRECTION_INCLUDE,
      orderBy: { createdAt: "desc" },
    })
    // canDecide is the viewer's, not the row's — a reporter sees their own proposal but no buttons.
    const canDecide = (await getAttendanceWorkspaceContext(me)).canManageAttendance
    return NextResponse.json({ corrections: corrections.map(serializeAttendanceCorrection), canDecide })
  } catch (error) {
    console.error("Error listing attendance corrections:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/complaints/[id]/correction — two shapes on one route:
//   { decision: "PROPOSE", date, checkInAt?, checkOutAt?, reason }  — the reporter (or a BoD) files a
//     proposal in their own name. Writes nothing but the proposal row and a thread message.
//   { decision: "APPROVE" | "REJECT", correctionId?, note? }  — BoD / One-Above-All / system admin only. APPROVE writes the AttendanceRecord; REJECT touches nothing
// but the proposal row.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id
    const { id } = await params

    const payload = await request.json().catch(() => ({}))
    const decision = String(payload?.decision ?? "").toUpperCase() as CorrectionDecision | "PROPOSE"

    // ---- PROPOSE: the reporter asks for the change in their own name. ---------------------------
    // Deliberately ABOVE the attendance gate, because this writes a proposal and never an
    // AttendanceRecord — the BoD tap below is still the only thing that touches attendance. It runs
    // the same proposeAttendanceCorrection GIDEON uses, with the same guardrails (own ticket, own
    // day, ATTENDANCE or EXP category, one live proposal); only the authorship differs, so the card says
    // who asked. This exists because GIDEON declining — or being down — must not be the only way a
    // wrong absen gets in front of a human.
    if (decision === "PROPOSE") {
      try {
        const result = await proposeAttendanceCorrection(
          { id: me, name: session.user.name ?? null },
          {
            complaintId: id,
            date: payload?.date,
            attendanceDate: payload?.attendanceDate,
            checkInAt: payload?.checkInAt,
            checkOutAt: payload?.checkOutAt,
            reason: payload?.reason,
          },
          me,
        )
        const complaint = await prisma.complaint.findUnique({
          where: { id },
          select: { workspaceId: true, reporterId: true },
        })
        if (complaint) {
          // fromReviewer: false → every BoD gets pinged that there is something to approve.
          void notifyComplaintReply({
            complaintId: id, workspaceId: complaint.workspaceId, reporterId: complaint.reporterId,
            fromReviewer: false, replierId: me,
          }).catch(() => {})
        }
        logAudit({ action: "create", entityType: "attendance_correction", entityId: result.id, userId: me, request, metadata: { source: "reporter", date: String(payload?.date ?? "") } })
        return NextResponse.json({ correction: result })
      } catch (error) {
        // Every throw in there is a sentence written to be read by the person who typed the form.
        const message = error instanceof Error ? error.message : "Gagal mengusulkan koreksi."
        const status = message.includes("not accessible") ? 404 : 422
        return NextResponse.json({ error: message }, { status })
      }
    }

    // Same gate as every other attendance write in the app (BoD / One-Above-All / system ADMIN). A team
    // lead's team-scoped powers deliberately do NOT reach here: this rewrites the attendance history a
    // payroll run reads.
    const context = await getAttendanceWorkspaceContext(me)
    if (!context.workspace || !context.canManageAttendance) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (decision !== "APPROVE" && decision !== "REJECT") {
      return NextResponse.json({ error: 'decision harus "APPROVE" atau "REJECT".' }, { status: 422 })
    }
    const note = String(payload?.note ?? "").trim().slice(0, CORRECTION_NOTE_MAX) || null
    const correctionId = String(payload?.correctionId ?? "").trim() || null

    const complaint = await prisma.complaint.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, reporterId: true, status: true },
    })
    if (!complaint || complaint.workspaceId !== context.workspace.id) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Without an explicit id, decide the ticket's single live proposal — one tap, which is the point.
    const correction = await prisma.attendanceCorrection.findFirst({
      where: { complaintId: id, ...(correctionId ? { id: correctionId } : { status: "PENDING" }) },
      orderBy: { createdAt: "desc" },
    })
    if (!correction) return NextResponse.json({ error: "Gak ada usulan koreksi di tiket ini." }, { status: 404 })
    if (correction.status !== "PENDING") {
      return NextResponse.json({ error: `Usulan ini udah ${correction.status === "APPROVED" ? "di-approve" : "ditolak"} sebelumnya.` }, { status: 409 })
    }

    const dateKey = formatAttendanceDateKey(correction.attendanceDate)
    const decidedAt = new Date()

    // ---- REJECT: nothing but the proposal row moves. -------------------------------------------
    if (decision === "REJECT") {
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.attendanceCorrection.update({
          where: { id: correction.id },
          data: { status: "REJECTED", decidedById: me, decidedAt, decisionNote: note },
          include: ATTENDANCE_CORRECTION_INCLUDE,
        })
        await tx.complaintMessage.create({
          data: {
            complaintId: id,
            authorId: me,
            fromReviewer: true,
            body: `Usulan koreksi absen ${dateKey} DITOLAK.${note ? ` Catatan: ${note}` : ""}`.slice(0, BODY_MAX),
          },
        })
        await tx.complaint.update({ where: { id }, data: { lastMessageAt: decidedAt } })
        await tx.complaintEvent.create({ data: { complaintId: id, action: "correction_rejected", actorId: me } })
        return row
      })

      logAudit({ action: "update", entityType: "attendance_correction", entityId: correction.id, userId: me, request, metadata: { decision: "REJECT", date: dateKey, note } })
      void notifyComplaintReply({ complaintId: id, workspaceId: complaint.workspaceId, reporterId: complaint.reporterId, fromReviewer: true, replierId: me }).catch(() => {})
      return NextResponse.json({ correction: serializeAttendanceCorrection(updated), record: null })
    }

    // ---- APPROVE: the one attendance write in this flow. ----------------------------------------
    const record = await prisma.attendanceRecord.findUnique({
      where: {
        userId_workspaceId_attendanceDate: {
          userId: correction.userId,
          workspaceId: correction.workspaceId,
          attendanceDate: correction.attendanceDate,
        },
      },
      include: { officeLocation: true },
    })
    // A proposal made against an EXISTING record whose record has since vanished is still refused —
    // that is drift, and approving it would resurrect a day a BoD deliberately deleted.
    if (!record && correction.beforeRecordId) {
      return NextResponse.json(
        { error: `Record absen ${dateKey} udah gak ada (kehapus setelah usulan ini dibikin), jadi gak ada yang bisa dikoreksi. Tolak usulan ini dan pakai jalur pengajuan izin/cuti kalau harinya emang kosong.` },
        { status: 409 }
      )
    }
    // The other case is a day that never had a record — the commonest complaint of all, "check-in
    // never landed". Creating one needs an office, which nothing in the proposal carries: the person
    // was not geolocated because the check-in never happened. Taken from where they actually check
    // in, falling back to the workspace's only office; with several and no history, a human does it
    // by hand rather than the system picking a building for them.
    let creationOfficeId: string | null = null
    if (!record) {
      const usual = await prisma.attendanceRecord.findFirst({
        where: { userId: correction.userId, workspaceId: complaint.workspaceId },
        orderBy: { attendanceDate: "desc" },
        select: { officeLocationId: true },
      })
      if (usual) {
        creationOfficeId = usual.officeLocationId
      } else {
        const offices = await prisma.officeLocation.findMany({
          where: { workspaceId: complaint.workspaceId, isActive: true },
          select: { id: true },
          take: 2,
        })
        if (offices.length === 1) creationOfficeId = offices[0].id
      }
      if (!creationOfficeId) {
        return NextResponse.json(
          { error: `Belum ada catatan absen ${dateKey} dan kantornya gak bisa ditentukan otomatis (orang ini belum pernah absen, dan workspace punya lebih dari satu kantor aktif). Buat recordnya manual lewat menu absensi.` },
          { status: 422 }
        )
      }
    }

    // Optimistic lock against the snapshot. If someone corrected the same day by hand in the meantime,
    // approving would silently overwrite their edit AND leave a "before" snapshot that no longer
    // matches reality — the one thing that makes an approval reversible.
    // Drift only means anything when there was something to drift from.
    if (record && (!eq(record.checkInAt, correction.beforeCheckInAt) || !eq(record.checkOutAt, correction.beforeCheckOutAt))) {
      return NextResponse.json(
        { error: `Absen ${dateKey} udah berubah sejak usulan ini dibikin. Tolak usulan ini terus minta dibikinin usulan baru dari data terkini.` },
        { status: 409 }
      )
    }
    // Creating a day and correcting one need the same three facts. Resolved once so everything below
    // reads the same whether the record exists yet or not.
    const office = record?.officeLocation ?? (await prisma.officeLocation.findUnique({ where: { id: creationOfficeId! } }))
    if (!office) return NextResponse.json({ error: "Kantor buat record ini gak ketemu." }, { status: 422 })
    const targetUserId = record?.userId ?? correction.userId
    const targetWorkspaceId = record?.workspaceId ?? complaint.workspaceId
    const targetDate = record?.attendanceDate ?? correction.attendanceDate

    const nextCheckInAt = correction.proposedCheckInAt ?? record?.checkInAt ?? null
    const nextCheckOutAt = correction.proposedCheckOutAt ?? record?.checkOutAt ?? null
    if (!nextCheckInAt) return NextResponse.json({ error: "Check-in wajib ada di record absen." }, { status: 422 })
    const timeError = validateCorrectionTimes(dateKey, nextCheckInAt, nextCheckOutAt)
    if (timeError) return NextResponse.json({ error: timeError }, { status: 422 })

    // Re-derive late/early/worked from the day itself, exactly like the manual correction at
    // PATCH /api/attendance/records/[recordId]. Writing the times alone leaves lateMinutes lying.
    const effectiveShift = await resolveEffectiveAttendanceShift({
      userId: targetUserId,
      workspaceId: targetWorkspaceId,
      office,
      date: targetDate,
    })
    const derived = buildAttendanceDerivedFields({
      attendanceDate: targetDate,
      checkInAt: nextCheckInAt,
      checkOutAt: nextCheckOutAt,
      office,
      effectiveShift,
      treatAsNonWorkday: await isHoliday(targetWorkspaceId, targetDate),
    })

    const summary = describeCorrection({
      dateKey,
      beforeCheckInAt: record?.checkInAt ?? null,
      beforeCheckOutAt: record?.checkOutAt ?? null,
      proposedCheckInAt: correction.proposedCheckInAt,
      proposedCheckOutAt: correction.proposedCheckOutAt,
    })
    // A BoD picking up an OPEN ticket flips it to IN_REVIEW, same rule as replying in the thread.
    const bumpToReview = complaint.status === "OPEN"

    const { correction: updatedCorrection, record: updatedRecord } = await prisma.$transaction(async (tx) => {
      // Same shape, two verbs. An update carries the corrected times onto a day that exists; a create
      // writes the day the outage never let happen, and needs the three identity columns as well.
      const shared = {
        checkInAt: nextCheckInAt,
          checkOutAt: nextCheckOutAt,
          status: derived.status,
          attendanceFlexi: derived.attendanceFlexi,
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
          correctedAt: decidedAt,
          // The approver owns the change, not GIDEON and not the reporter. Whoever tapped is who
          // answers for it later.
          correctedById: me,
          correctionReason: `Tiket ${id}: ${correction.reason}`.slice(0, 1000),
      }
      const include = {
        officeLocation: true,
        user: { select: { id: true, name: true, email: true, avatar: true } },
        correctedBy: { select: { id: true, name: true, email: true } },
      }
      const written = record
        ? await tx.attendanceRecord.update({ where: { id: record.id }, data: shared, include })
        : await tx.attendanceRecord.create({
            data: {
              ...shared,
              userId: targetUserId,
              workspaceId: targetWorkspaceId,
              officeLocationId: office.id,
              attendanceDate: targetDate,
            },
            include,
          })
      const row = await tx.attendanceCorrection.update({
        where: { id: correction.id },
        data: { status: "APPROVED", decidedById: me, decidedAt, decisionNote: note },
        include: ATTENDANCE_CORRECTION_INCLUDE,
      })
      await tx.complaintMessage.create({
        data: {
          complaintId: id,
          authorId: me,
          fromReviewer: true,
          body: `Koreksi absen di-APPROVE — ${summary}.${note ? ` Catatan: ${note}` : ""}`.slice(0, BODY_MAX),
        },
      })
      await tx.complaint.update({
        where: { id },
        data: { lastMessageAt: decidedAt, ...(bumpToReview ? { status: "IN_REVIEW" } : {}) },
      })
      await tx.complaintEvent.create({ data: { complaintId: id, action: "correction_approved", actorId: me } })
      if (bumpToReview) {
        await tx.complaintEvent.create({ data: { complaintId: id, action: "status", fromStatus: "OPEN", toStatus: "IN_REVIEW", actorId: me } })
      }
      return { correction: row, record: written }
    })

    // The XP the day cost has to come back, or the correction is only half done: the record now says
    // "hadir tepat waktu" while the ledger still shows the late/alpha deduction that record no longer
    // justifies. Only when the corrected day is genuinely clean — a correction that leaves somebody
    // late must not refund a late penalty they still earned.
    let penaltiesReversed = false
    if (updatedRecord.checkInAt && (updatedRecord.lateMinutes ?? 0) === 0) {
      try {
        penaltiesReversed = await cancelAttendancePenaltiesForDate(
          updatedRecord.userId, complaint.workspaceId, updatedRecord.attendanceDate, dateKey,
        )
        // The refund alone does not hold. The nightly job re-derives penalties across a rolling
        // window and would simply re-cut the same XP tomorrow; the waiver is the marker that stops
        // it. Without this the member sees their points return and quietly vanish overnight.
        await grantAttendanceWaiver(updatedRecord.userId, dateKey)
      } catch (error) {
        // The attendance record is already correct and committed. A failed refund is worth shouting
        // about, but not worth telling the approver their approval failed when it did not.
        console.error("attendance correction: XP reversal failed", { correctionId: correction.id, error })
      }
    }

    logAudit({
      action: "update",
      entityType: "attendance_record",
      entityId: updatedRecord.id,
      entityName: `${updatedRecord.user.name} — koreksi absen via tiket`,
      userId: me,
      request,
      metadata: {
        complaintId: id,
        correctionId: correction.id,
        date: dateKey,
        summary,
        before: { checkInAt: correction.beforeCheckInAt, checkOutAt: correction.beforeCheckOutAt, status: correction.beforeStatus },
        reason: correction.reason,
        penaltiesReversed,
      },
    })
    void notifyComplaintReply({ complaintId: id, workspaceId: complaint.workspaceId, reporterId: complaint.reporterId, fromReviewer: true, replierId: me }).catch(() => {})

    return NextResponse.json({
      correction: serializeAttendanceCorrection(updatedCorrection),
      record: serializeAttendanceRecord(updatedRecord),
    })
  } catch (error) {
    console.error("Error deciding attendance correction:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
