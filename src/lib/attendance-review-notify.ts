// In-app + push notices for attendance decisions: a request approved/rejected, a member-day rewritten
// by a BoD, an offsite checkout reviewed. These lived in the WhatsApp bot (lib/wa-bot.ts) next to the
// WA copies; the NEXUS WhatsApp feature was removed on 12 Oct 2026 (owner: "fitur whatsapp, webhooks
// hapus aja"), so only the in-app/push half remains — same titles, texts, links and push flags.
import prisma from "@/lib/prisma"
import { createInAppNotification } from "@/lib/notification-service"
import { bi } from "@/lib/notification-text"

const REQ_TYPE_LABEL: Record<string, string> = {
  LEAVE: "Cuti", SICK: "Sakit", PERMIT: "Izin", DAY_OFF: "Day off", RED_DATE: "Tanggal merah",
}
const REQ_TYPE_LABEL_EN: Record<string, string> = {
  LEAVE: "Leave", SICK: "Sick leave", PERMIT: "Permission", DAY_OFF: "Day off", RED_DATE: "Public holiday",
}
function fmtDateRangeEn(start: Date, end: Date) {
  const f = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).replace(/\bSept\b/, "Sep")
  const s = f(start), e = f(end)
  return s === e ? s : `${s}–${e}`
}

function fmtDateRange(start: Date, end: Date) {
  const f = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })
  const s = f(start), e = f(end)
  return s === e ? s : `${s}–${e}`
}

function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "BoD"
}

/** After an attendance request is approved/rejected: tell the requester the outcome and who decided. */
export async function notifyAttendanceRequestReviewed(input: {
  requestId: string; reviewerId: string; reviewerName: string | null; approved: boolean; note?: string | null
  /** XP the approval handed back (positive). Told to the requester — see refundSuffix below. */
  xpRefunded?: number
}): Promise<void> {
  const req = await prisma.attendanceRequest.findUnique({
    where: { id: input.requestId },
    select: { type: true, startDate: true, endDate: true, userId: true },
  })
  if (!req) return
  // The degenerate self-review tells nobody.
  if (req.userId === input.reviewerId) return
  const label = REQ_TYPE_LABEL[req.type] ?? req.type
  const range = fmtDateRange(req.startDate, req.endDate)
  const who = firstNameOf(input.reviewerName)
  const verb = input.approved ? "APPROVE" : "TOLAK"
  // The reason travels with the decision: a rejection the requester can't explain to themselves is
  // the bug this once fixed.
  const note = input.note?.trim() || null
  const noteSuffix = note ? ` Alasan: "${note}"` : ""
  // A refund is not a silent correction: if approving gave XP back, the requester hears it with the decision.
  const refunded = input.approved ? Math.max(0, input.xpRefunded ?? 0) : 0
  const refundSuffix = refunded > 0 ? ` Penalti absen hari itu dibatalin — +${refunded} XP balik.` : ""

  await createInAppNotification({
    userId: req.userId,
    type: "attendance_request_reviewed",
    ...bi(
      [input.approved ? "Attendance request approved" : "Attendance request rejected",
        `${who} ${input.approved ? "approved" : "rejected"} your ${(REQ_TYPE_LABEL_EN[req.type] ?? req.type).toLowerCase()} (${fmtDateRangeEn(req.startDate, req.endDate)}).${note ? ` Reason: "${note}"` : ""}${refunded > 0 ? ` That day's attendance penalty is cancelled — +${refunded} XP back.` : ""}`],
      [input.approved ? "Permintaan absen di-approve" : "Permintaan absen ditolak", `${label} kamu (${range}) di-${verb} sama ${who}.${noteSuffix}${refundSuffix}`],
    ),
    link: `/attendance?request=${input.requestId}`,
    // A decision is exactly the kind of thing you shouldn't have to open the app to learn.
    push: true,
  }).catch(() => {})
  // The other approvers are deliberately not told "handled" (4,243 such rows, 87 % never read).
}

const OVERRIDE_STATUS_LABEL: Record<string, string> = { PRESENT: "Hadir", LEAVE: "Cuti", SICK: "Sakit", DAY_OFF: "Day off", PERMIT: "Izin" }

/** A BoD rewrote a member-day from the crew board (status change or clear-penalty) → tell that member. */
export async function notifyAttendanceOverride(input: {
  workspaceId: string; targetUserId: string; actorId: string; actorName?: string | null
  dateKey: string; action: "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "PERMIT" | "CLEAR_PENALTY"; note?: string | null
}): Promise<void> {
  const isSelf = input.targetUserId === input.actorId // self-changes still notify (user opted in)
  const [target, actorName] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.targetUserId }, select: { id: true } }),
    input.actorName != null
      ? Promise.resolve(input.actorName)
      : prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true } }).then((u) => u?.name ?? null),
  ])
  if (!target) return
  const who = firstNameOf(actorName)
  const by = isSelf ? "" : ` sama ${who}` // omit "by X" when you changed your own day
  const d = new Date(`${input.dateKey}T00:00:00+07:00`)
  const dateStr = isNaN(d.getTime()) ? input.dateKey : fmtDateRange(d, d)

  const dateEn = isNaN(d.getTime()) ? input.dateKey : fmtDateRangeEn(d, d)
  const byEn = isSelf ? "" : ` by ${who}`
  const OVERRIDE_EN: Record<string, string> = { PRESENT: "Present", LEAVE: "Leave", SICK: "Sick leave", DAY_OFF: "Day off", PERMIT: "Permission" }
  const en: [string, string] = input.action === "CLEAR_PENALTY"
    ? ["Attendance penalty cleared", `Your attendance penalty (${dateEn}) was cleared${byEn} — XP and day off are restored.`]
    : ["Your attendance status changed", `Your attendance status (${dateEn}) was changed to ${OVERRIDE_EN[input.action] ?? input.action}${byEn}.`]
  let title: string, message: string
  if (input.action === "CLEAR_PENALTY") {
    title = "Penalty absen dibersihin"
    message = `Penalty absen kamu (${dateStr}) dibersihin${by} — XP & jatah day-off dipulihin.`
  } else {
    const sl = OVERRIDE_STATUS_LABEL[input.action] ?? input.action
    title = "Status absen kamu diubah"
    message = `Status absen kamu (${dateStr}) diubah jadi ${sl}${by}.`
  }
  // Pushed: a day flipped to Cuti/Sakit/Day-off (which also closes their open record) is not
  // something to discover by opening the app.
  await createInAppNotification({ userId: target.id, type: "attendance_override", ...bi(en, [title, message]), link: "/attendance", push: true }).catch(() => {})
}

/** An offsite checkout was approved/rejected → tell the staff member. */
export async function notifyOffsiteCheckoutReviewed(input: {
  recordId: string; reviewerId: string; reviewerName?: string | null; approved: boolean
}): Promise<void> {
  const rec = await prisma.attendanceRecord.findUnique({
    where: { id: input.recordId },
    select: { userId: true, attendanceDate: true },
  })
  if (!rec || rec.userId === input.reviewerId) return
  const who = firstNameOf(input.reviewerName)
  const dateStr = fmtDateRange(rec.attendanceDate, rec.attendanceDate)
  const verb = input.approved ? "APPROVE" : "TOLAK"
  await createInAppNotification({
    userId: rec.userId,
    type: "offsite_checkout_reviewed",
    ...bi(
      [input.approved ? "Off-site check-out approved" : "Off-site check-out rejected",
        `${who} ${input.approved ? "approved" : "rejected"} your off-site check-out (${fmtDateRangeEn(rec.attendanceDate, rec.attendanceDate)}).${input.approved ? "" : " It counts as no check-out (−25 XP)."}`],
      [input.approved ? "Checkout di luar di-approve" : "Checkout di luar ditolak", `Check-out di luar (${dateStr}) di-${verb} sama ${who}.${input.approved ? "" : " Dihitung seperti tidak check-out (−25 XP)."}`],
    ),
    link: `/attendance?offsite=${input.recordId}`,
    // A rejection costs 25 XP; it pushes like the request-review notice.
    push: true,
  }).catch(() => {})
  // No "sudah diproses" fan-out to the other approvers (547 unread rows piled up for the same reason).
}
