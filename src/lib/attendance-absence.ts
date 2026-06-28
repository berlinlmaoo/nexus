import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import {
  enumerateAttendanceDates,
  FLEXI_WINDOW_END,
  formatAttendanceDateKey,
  getAttendanceDate,
  getPrimaryAttendanceTeam,
  isWorkdayForAttendanceDate,
  minutesLateAgainstShift,
  resolveEffectiveAttendanceShift,
  safeAttendanceTimezone,
} from "@/lib/attendance"
import { awardXpOnce, setLatePenalty, clearLatePenalty, refundXpByReason, refundXpByReasonTx } from "@/lib/gamification"
import { getHolidayKeys, isHoliday } from "@/lib/holidays"

const ONE_DAY_MS = 24 * 60 * 60 * 1000
// Don't auto-deduct (or apply ANY attendance XP penalty) for days before the policy went live — avoids
// retroactively punishing old absences. Fail-SAFE default: if the env var is missing/blank/invalid the
// floor stays at the safe go-live date, not an older one. Override via env ABSENCE_DEDUCTION_START_DATE.
const DEFAULT_START_DATE = "2026-06-07"
const DEFAULT_LOOKBACK_DAYS = 14

export function startFloor() {
  const raw = (process.env.ABSENCE_DEDUCTION_START_DATE || "").trim() || DEFAULT_START_DATE
  const d = new Date(`${raw}T00:00:00.000Z`)
  return isNaN(d.getTime()) ? new Date(`${DEFAULT_START_DATE}T00:00:00.000Z`) : d
}

/**
 * Dates (YYYY-MM-DD, Asia/Jakarta) the system was DOWN so staff physically couldn't check in/out.
 * On these days BOTH attendance crons skip ALL penalty work — no live late accrual, no nightly
 * late/no-checkout/alpha XP, and no day-off cut — because an outage is not the staff's fault. Set via
 * env `ATTENDANCE_OUTAGE_DATES` (comma-separated, e.g. "2026-06-09,2026-07-01"). Empty by default.
 */
export function getOutageDateKeys(): Set<string> {
  return new Set(
    (process.env.ATTENDANCE_OUTAGE_DATES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
}
export function isOutageDate(dateKey: string): boolean {
  return getOutageDateKeys().has(dateKey)
}

/**
 * Cancel EVERY attendance penalty for a date — used when a real (manually-filed) leave/day-off covers
 * it. Refunds the late, no-checkout, and alpha XP, and drops the cron's own auto-deduction day-off so
 * the user's real leave isn't double-counted against their quota.
 */
export async function cancelAttendancePenaltiesForDate(userId: string, workspaceId: string, date: Date, dateKey: string): Promise<boolean> {
  // All-or-nothing: the three XP refunds + the auto day-off drop happen in ONE transaction, so a crash
  // mid-way can't leave the member with (say) the late XP back but the alpha penalty still applied. Each
  // refund is advisory-locked on its (userId, reason), so a concurrent BoD override + cron amnesty can't
  // double-credit.
  return await prisma.$transaction(async (tx) => {
    const late = await refundXpByReasonTx(tx, userId, `attendance:late:${dateKey}`)
    const noCheckout = await refundXpByReasonTx(tx, userId, `attendance:nocheckout:${dateKey}`)
    const alpha = await refundXpByReasonTx(tx, userId, `attendance:alpha:${dateKey}`)
    const dropped = await tx.attendanceRequest.deleteMany({
      where: { userId, workspaceId, type: "DAY_OFF", reviewedById: null, approvalSource: "ADMIN", reason: { startsWith: "Auto:" }, startDate: { lte: date }, endDate: { gte: date } },
    })
    // Did this actually undo a penalty? (used by the outage amnesty to count only real refunds)
    return late > 0 || noCheckout > 0 || alpha > 0 || dropped.count > 0
  })
}

/**
 * Refund EVERY attendance penalty across a date range (inclusive) — used the moment a leave/permit/
 * day-off is FILED or APPROVED, so the covered days are cleared immediately and independently of the
 * nightly cron's 14-day window (which otherwise can't reach older dates). Idempotent: each per-date
 * cancel only refunds what actually exists. Returns the number of days that had a penalty undone.
 */
export async function cancelAttendancePenaltiesForRange(userId: string, workspaceId: string, start: Date, end: Date): Promise<number> {
  let cleared = 0
  for (const date of enumerateAttendanceDates(start, end)) {
    const dateKey = formatAttendanceDateKey(date)
    if (await cancelAttendancePenaltiesForDate(userId, workspaceId, date, dateKey)) cleared++
  }
  return cleared
}

/**
 * Per-member-per-day penalty WAIVER ("hapus punishment" from the BoD board). Stored as a 0-XP ledger
 * row so it survives restarts and is visible in audits. While it exists, NO attendance penalty may be
 * (re-)applied for that member-day: without it, a penalty refund would not stick — the nightly cron
 * re-derives penalties for every day in its 14-day window and would simply re-cut the XP/day-off.
 */
export function attendanceWaiverReason(dateKey: string) {
  return `attendance:waiver:${dateKey}`
}
export async function hasAttendanceWaiver(userId: string, dateKey: string): Promise<boolean> {
  const row = await prisma.xpTransaction.findFirst({
    where: { userId, reason: attendanceWaiverReason(dateKey) },
    select: { id: true },
  })
  return Boolean(row)
}
export async function grantAttendanceWaiver(userId: string, dateKey: string) {
  if (await hasAttendanceWaiver(userId, dateKey)) return
  await prisma.xpTransaction.create({
    data: { userId, amount: 0, reason: attendanceWaiverReason(dateKey) },
  })
}

/**
 * True if a covering request is the cron's own auto-deduction (NOT a real user-filed leave). These
 * are PENALTIES (e.g. ">120 min late → −1 day-off token", or auto-absence), so attendance flows
 * (check-in/check-out) and the report must NOT treat them like a real day-off: they should never block
 * a present staffer from completing attendance, nor hide their actual present record.
 */
export function isAutoDeduction(r: { reason: string | null; reviewedById: string | null; approvalSource: string | null }) {
  return r.approvalSource === "ADMIN" && r.reviewedById === null && (r.reason ?? "").startsWith("Auto:")
}

/**
 * Delete dangling OPEN check-ins (status CHECKED_IN, no check-out) whose date is now covered by a REAL
 * approved leave/day-off (mirrors exactly what blocks check-out). When a day-off/leave request is
 * approved AFTER the staff already checked in, the open record can never be checked out (the covering
 * request blocks completion) AND it blocks the next day's check-in ("Selesaikan absen kemarin" loop).
 * The day is officially off, so the open check-in is spurious → remove it. Auto-deduction day-offs don't
 * count (those are penalties filed for days actually worked). Best-effort; returns the deleted IDs.
 */
export async function clearLeaveCoveredOpenRecords(userId: string, workspaceId: string): Promise<string[]> {
  const open = await prisma.attendanceRecord.findMany({
    where: { userId, workspaceId, status: "CHECKED_IN", checkOutAt: null },
    select: { id: true, attendanceDate: true },
  })
  if (open.length === 0) return []
  const times = open.map((r) => r.attendanceDate.getTime())
  const covering = await prisma.attendanceRequest.findMany({
    where: {
      userId,
      workspaceId,
      status: "APPROVED",
      startDate: { lte: new Date(Math.max(...times)) },
      endDate: { gte: new Date(Math.min(...times)) },
    },
    select: { startDate: true, endDate: true, reason: true, reviewedById: true, approvalSource: true },
  })
  const real = covering.filter((r) => !isAutoDeduction(r))
  if (real.length === 0) return []
  const ids = open
    .filter((rec) => real.some((r) => r.startDate.getTime() <= rec.attendanceDate.getTime() && rec.attendanceDate.getTime() <= r.endDate.getTime()))
    .map((r) => r.id)
  if (ids.length === 0) return []
  await prisma.attendanceRecord.deleteMany({ where: { id: { in: ids } } })
  return ids
}

/**
 * Create the cron's auto "potong jatah day-off" request for one member-day, but ONLY if no PENDING/
 * APPROVED day-off already covers that date — idempotently. The re-check + create run inside one
 * transaction guarded by a (userId, dateKey) advisory lock, so two overlapping deduction runs (e.g. the
 * 02:00 cron and a manual "run now") can't both pass a stale duplicate-check and double-cut the quota.
 * Returns the new request id, or null if one already existed.
 */
async function createAutoDayOffOnce(opts: {
  userId: string
  workspaceId: string
  teamId: string | null
  date: Date
  dateKey: string
  reason: string
  reviewNote: string
}): Promise<string | null> {
  const { userId, workspaceId, teamId, date, dateKey, reason, reviewNote } = opts
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`autodayoff|${userId}|${dateKey}`})::int8)`
    const dup = await tx.attendanceRequest.findFirst({
      where: { userId, workspaceId, type: "DAY_OFF", status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true },
    })
    if (dup) return null
    const created = await tx.attendanceRequest.create({
      data: { userId, workspaceId, teamId, type: "DAY_OFF", status: "APPROVED", startDate: date, endDate: date, reason, reviewNote, approvalSource: "ADMIN", reviewedAt: new Date(), reviewedById: null },
      select: { id: true },
    })
    return created.id
  })
}

export interface OutageRefundMemberEntry {
  userId: string
  name: string | null
  /** Late XP penalty currently on the ledger for the day (negative; 0 if none). */
  lateXp: number
  /** No-checkout XP penalty (negative; 0 if none — usually 0 until the nightly runs). */
  noCheckoutXp: number
  /** Alpha (no-show) XP penalty (negative; 0 if none — usually 0 until the nightly runs). */
  alphaXp: number
  /** Auto-deducted day-off requests covering the day (the cron's "Auto:" ones). */
  autoDayOffs: number
  /** Positive XP that would be / was given back (= -(late+noCheckout+alpha)). */
  xpRefund: number
  /** Why this member was skipped, if any. */
  excludedReason: string | null
}

export interface OutageRefundResult {
  date: string
  workspaceId: string
  dryRun: boolean
  /** Members whose penalties were (or would be) refunded. */
  refundedMembers: number
  /** Members skipped because they already filed a real day-off/leave for the day. */
  excludedMembers: number
  /** Total XP given back across all members (positive). */
  totalXpRefunded: number
  /** Total auto day-off requests removed (quota restored). */
  totalDayOffsRestored: number
  /** Members whose processing threw (only in a real run). */
  failed: number
  /** Per-member breakdown (only members with something to refund, or an exclusion, are listed). */
  entries: OutageRefundMemberEntry[]
}

/** Read the attendance penalties currently on the ledger for one member + date (no mutation). */
async function readOutagePenalties(userId: string, workspaceId: string, date: Date, dateKey: string) {
  const lateReason = `attendance:late:${dateKey}`
  const noCheckoutReason = `attendance:nocheckout:${dateKey}`
  const alphaReason = `attendance:alpha:${dateKey}`
  const txns = await prisma.xpTransaction.findMany({
    where: { userId, reason: { in: [lateReason, noCheckoutReason, alphaReason] } },
    select: { reason: true, amount: true },
  })
  let lateXp = 0
  let noCheckoutXp = 0
  let alphaXp = 0
  for (const t of txns) {
    if (t.reason === lateReason) lateXp += t.amount
    else if (t.reason === noCheckoutReason) noCheckoutXp += t.amount
    else if (t.reason === alphaReason) alphaXp += t.amount
  }
  const autoDayOffs = await prisma.attendanceRequest.count({
    where: { userId, workspaceId, type: "DAY_OFF", reviewedById: null, approvalSource: "ADMIN", reason: { startsWith: "Auto:" }, startDate: { lte: date }, endDate: { gte: date } },
  })
  return { lateXp, noCheckoutXp, alphaXp, autoDayOffs }
}

/**
 * Refund attendance penalties wrongly applied on a SYSTEM-OUTAGE day. For ONE workspace + ONE date,
 * for every attendance-bearing member (everyone except BoD / One Above All):
 *   - SKIP anyone who already filed a real (non-`Auto:`) day-off/leave/izin covering the day — they
 *     chose to be off, they're not an outage victim, and their request is left untouched.
 *   - otherwise REFUND the day's penalties: late XP, no-checkout XP, alpha XP, and drop the cron's
 *     auto day-off (restoring quota) — via cancelAttendancePenaltiesForDate.
 * Present/absent STATUS is never changed and NO covering/excuse request is created — the day is just
 * made penalty-free. Pair with `ATTENDANCE_OUTAGE_DATES` (so the crons skip the day) to make it stick.
 * Pass `dryRun: true` to preview exactly what would be refunded without mutating anything.
 */
export async function refundOutageDay(opts: {
  workspaceId: string
  date: Date
  dryRun?: boolean
  adminUserId?: string | null
  request?: Request
}): Promise<OutageRefundResult> {
  const { workspaceId, date } = opts
  const dryRun = opts.dryRun ?? false
  const dateKey = formatAttendanceDateKey(date)

  const result: OutageRefundResult = {
    date: dateKey,
    workspaceId,
    dryRun,
    refundedMembers: 0,
    excludedMembers: 0,
    totalXpRefunded: 0,
    totalDayOffsRestored: 0,
    failed: 0,
    entries: [],
  }

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: { notIn: ["BOD", "ONE_ABOVE_ALL"] } },
    select: { userId: true, user: { select: { id: true, name: true } } },
  })

  for (const member of members) {
    const userId = member.userId
    const name = member.user?.name ?? null
    try {
      // Already on a real day-off / leave for this day → exclude (their choice; leave them alone).
      const covering = await prisma.attendanceRequest.findMany({
        where: { userId, workspaceId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: date }, endDate: { gte: date } },
        select: { reason: true, reviewedById: true, approvalSource: true },
      })
      if (covering.some((r) => !isAutoDeduction(r))) {
        result.excludedMembers++
        result.entries.push({ userId, name, lateXp: 0, noCheckoutXp: 0, alphaXp: 0, autoDayOffs: 0, xpRefund: 0, excludedReason: "sudah request day-off/izin hari ini" })
        continue
      }

      const pen = await readOutagePenalties(userId, workspaceId, date, dateKey)
      const xpRefund = -(pen.lateXp + pen.noCheckoutXp + pen.alphaXp) // negatives → positive refund
      const hasSomething = xpRefund > 0 || pen.autoDayOffs > 0
      if (!hasSomething) continue // nothing was cut for this member → skip silently

      if (!dryRun) {
        await cancelAttendancePenaltiesForDate(userId, workspaceId, date, dateKey)
      }
      result.refundedMembers++
      result.totalXpRefunded += xpRefund
      result.totalDayOffsRestored += pen.autoDayOffs
      result.entries.push({ userId, name, lateXp: pen.lateXp, noCheckoutXp: pen.noCheckoutXp, alphaXp: pen.alphaXp, autoDayOffs: pen.autoDayOffs, xpRefund, excludedReason: null })
    } catch (err) {
      result.failed++
      console.error(`refundOutageDay: member ${userId} failed for ${dateKey}:`, err)
    }
  }

  if (!dryRun && opts.adminUserId) {
    await logAudit({
      action: "attendance_outage_refund",
      entityType: "workspace",
      entityId: workspaceId,
      entityName: `outage-refund:${dateKey}`,
      userId: opts.adminUserId,
      metadata: { date: dateKey, refundedMembers: result.refundedMembers, excludedMembers: result.excludedMembers, totalXpRefunded: result.totalXpRefunded, totalDayOffsRestored: result.totalDayOffsRestored, failed: result.failed },
      request: opts.request,
    })
  }

  return result
}

export interface AbsenceDeductionResult {
  from: string
  to: string
  processedDates: string[]
  created: number
  skipped: number
  entries: Array<{ userId: string; name: string | null; date: string }>
}

/**
 * Auto-deduct day-off for absent workdays: a member with NO check-in/out and NO
 * pending/approved request on a workday gets an APPROVED DAY_OFF (counts against quota,
 * no monthly cap — over-quota goes "minus"). Idempotent: re-runs skip days already
 * covered by a request. Days before the start floor are never touched.
 */
export async function processAbsenceDeductions(opts?: { from?: Date; to?: Date }): Promise<AbsenceDeductionResult> {
  const floor = startFloor()
  // Default window: [yesterday - lookback, yesterday] (today isn't over yet, so never processed).
  const yesterday = new Date(getAttendanceDate().getTime() - ONE_DAY_MS)
  let from = opts?.from ?? new Date(yesterday.getTime() - DEFAULT_LOOKBACK_DAYS * ONE_DAY_MS)
  let to = opts?.to ?? yesterday
  if (from.getTime() < floor.getTime()) from = floor
  if (to.getTime() > yesterday.getTime()) to = yesterday // never process today or future

  const result: AbsenceDeductionResult = {
    from: formatAttendanceDateKey(from),
    to: formatAttendanceDateKey(to),
    processedDates: [],
    created: 0,
    skipped: 0,
    entries: [],
  }
  if (from.getTime() > to.getTime()) return result

  const dates = enumerateAttendanceDates(from, to)

  // One active office per workspace (used for workdays/timezone).
  const offices = await prisma.officeLocation.findMany({ where: { isActive: true } })
  const officeByWorkspace = new Map<string, (typeof offices)[number]>()
  for (const o of offices) if (!officeByWorkspace.has(o.workspaceId)) officeByWorkspace.set(o.workspaceId, o)

  for (const [workspaceId, office] of officeByWorkspace) {
    // BoD & One Above All tidak wajib absen → dikecualiin dari auto-potong day-off.
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, role: { notIn: ["BOD", "ONE_ABOVE_ALL"] } },
      select: { userId: true, joinedAt: true, user: { select: { id: true, name: true, createdAt: true } } },
    })
    // Never penalize a member for workdays BEFORE they joined the workspace. The cron scans a 14-day
    // window floored only at the global go-live, so a new hire created mid-window was getting back-dated
    // absences for days they weren't employed yet. Floor each member at their own join day.
    const joinKeyByUser = new Map(
      members.map((m) => [m.userId, formatAttendanceDateKey(m.joinedAt ?? m.user?.createdAt ?? floor)] as const),
    )

    const holidayKeys = await getHolidayKeys(workspaceId, from, to) // tanggal merah → skip

    for (const date of dates) {
      if (!isWorkdayForAttendanceDate(date, office)) continue
      const dateKey = formatAttendanceDateKey(date)
      if (holidayKeys.has(dateKey)) continue // libur nasional → tidak dipotong/dipenalti
      if (isOutageDate(dateKey)) continue // sistem down → bukan salah staff, tidak dipotong/dipenalti

      for (const member of members) {
        const userId = member.userId

        // Pre-join guard: don't penalize days before this member joined the workspace.
        const joinKey = joinKeyByUser.get(userId)
        if (joinKey && dateKey < joinKey) { result.skipped++; continue }

        // Any leave/day-off covering this date. A MANUAL one (user-filed) cancels EVERY penalty for the
        // day — refund all XP + drop the auto-deduction. The cron's own AUTO day-off does NOT (it IS the
        // deduction). So a staffer who newly files a day-off gets all deducted XP refunded next cron run.
        const coveringReqs = await prisma.attendanceRequest.findMany({
          where: { userId, workspaceId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: date }, endDate: { gte: date } },
          select: { reason: true, reviewedById: true, approvalSource: true },
        })
        if (coveringReqs.some((r) => !isAutoDeduction(r))) {
          await cancelAttendancePenaltiesForDate(userId, workspaceId, date, dateKey)
          result.skipped++
          continue
        }

        // BoD pardoned this member-day ("hapus punishment") → never (re-)apply any penalty for it.
        if (await hasAttendanceWaiver(userId, dateKey)) {
          result.skipped++
          continue
        }

        const record = await prisma.attendanceRecord.findUnique({
          where: { userId_workspaceId_attendanceDate: { userId, workspaceId, attendanceDate: date } },
          select: { checkInAt: true, checkOutAt: true, checkOutApproval: true, correctedAt: true },
        })
        // Manually corrected records (BoD "ubah jadi Hadir" / admin correction) are authoritative —
        // don't re-derive penalties from their (possibly synthesized) timestamps.
        if (record?.correctedAt) {
          result.skipped++
          continue
        }
        if (record?.checkInAt || record?.checkOutAt) {
          // Hadir → bukan bolos, tapi tetap kena penalti XP: telat masuk & tidak absen keluar.
          try {
            if (record.checkInAt) {
              const shift = await resolveEffectiveAttendanceShift({ userId, workspaceId, office, date })
              // Anchor the late math to the SAME timezone the shift was selected in (office tz), so an
              // office in a non-default tz can't disagree with the shift-window day boundary.
              // Flexi members are on-time until the window END (15:00) — measure lateness against that,
              // not the window start (12:00), or a flexi person who checked in at 13:30 would be wrongly
              // (and permanently) penalized here.
              const lateBaseline = shift.flexi ? FLEXI_WINDOW_END : shift.shiftStartTime
              const lateMin = minutesLateAgainstShift(record.checkInAt, date, lateBaseline, safeAttendanceTimezone(office.timezone))
              const grace = Math.max(0, office.lateGraceMinutes ?? 0)
              if (lateMin > grace) {
                // -1 XP/menit, maks 120.
                await awardXpOnce(userId, -Math.min(lateMin, 120), `attendance:late:${dateKey}`)
                // Telat > 120 menit → potong jatah day-off (sekali, idempoten & aman dari run paralel).
                if (lateMin > 120) {
                  const primaryLate = await getPrimaryAttendanceTeam(userId, workspaceId)
                  await createAutoDayOffOnce({
                    userId, workspaceId, teamId: primaryLate?.teamId ?? null, date, dateKey,
                    reason: `Auto: telat >120 menit pada ${dateKey} (potong jatah day-off)`,
                    reviewNote: "Auto: telat >120 menit",
                  })
                }
              }
              // Penalti "lupa check-out" (−25) TIDAK lagi dipotong di sini. Cron jam 02:00 sering salah
              // menghukum staff yang lagi LEMBUR (jam shift kelewat tapi mereka masih kerja / belum sempat
              // check-out). Sekarang penalti itu dipicu pas mereka CHECK-IN lagi (lihat check-in route):
              // kalau record hari sebelumnya masih kebuka pas mereka mulai hari baru = beneran lupa → −25.
              // Yang lembur lalu check-out telat sendiri nggak punya record kebuka → nggak kena.
            }
          } catch {
            // XP penalty best-effort — jangan ganggu proses deduction.
          }
          continue
        }

        if (coveringReqs.length > 0) {
          // Only the cron's own auto-deduction day-off covers this date → already deducted; idempotent skip.
          result.skipped++
          continue
        }

        // Alpha (tanpa absen & tanpa kabar) → -150 XP/hari (selain potong day-off di bawah).
        // Alpha GANTIIN akrual telat: hapus dulu penalti telat yang udah nyicil hari itu
        // supaya nggak ditumpuk (-150 jadi satu-satunya potongan hari itu).
        await clearLatePenalty(userId, dateKey)
        await awardXpOnce(userId, -150, `attendance:alpha:${dateKey}`)

        const primary = await getPrimaryAttendanceTeam(userId, workspaceId)
        const createdId = await createAutoDayOffOnce({
          userId, workspaceId, teamId: primary?.teamId ?? null, date, dateKey,
          reason: `Auto: tidak check-in/out pada ${dateKey} (potong jatah day-off)`,
          reviewNote: "Auto-deducted: bolos (tanpa absen & tanpa izin)",
        })
        if (!createdId) {
          // A covering day-off appeared concurrently → don't double-count.
          result.skipped++
          continue
        }
        result.created++
        result.entries.push({ userId, name: member.user?.name ?? null, date: dateKey })

        try {
          await logAudit({
            action: "create",
            entityType: "attendance_request",
            entityId: createdId,
            entityName: `auto-dayoff:${member.user?.name ?? userId}`,
            userId,
            metadata: { reason: "auto_absence_deduction", date: dateKey },
          })
        } catch {
          // audit best-effort
        }
      }

      result.processedDates.push(dateKey)
    }
  }

  result.processedDates = Array.from(new Set(result.processedDates))
  return result
}

export interface LateAccrualResult {
  date: string
  accrued: number // users whose live late penalty was set/updated this run
  totalPenaltyXp: number // sum of current late penalties (negative)
}

/**
 * Real-time late accrual (called every minute by the late-accrual cron). For TODAY, every
 * non-BoD member who has NOT checked in yet, isn't on leave, and whose shift already
 * started gets their `attendance:late:DATE` penalty set to -min(minutes since shift start,
 * 120) — so XP ticks down -1/min live, without waiting for check-in. Once they check in the
 * penalty freezes (check-in stops touching it); if they never show, the nightly cron
 * reclassifies it as alpha (-150), which replaces this accrual.
 */
export async function accrueLatePenalties(now: Date = new Date()): Promise<LateAccrualResult> {
  const today = getAttendanceDate()
  const dateKey = formatAttendanceDateKey(today)
  const result: LateAccrualResult = { date: dateKey, accrued: 0, totalPenaltyXp: 0 }
  // Policy not live yet (e.g. before ABSENCE_DEDUCTION_START_DATE) → no live accrual at all.
  if (today.getTime() < startFloor().getTime()) return result
  // System outage day → staff can't check in; don't accrue late penalties at all.
  if (isOutageDate(dateKey)) return result

  const offices = await prisma.officeLocation.findMany({ where: { isActive: true } })
  const officeByWorkspace = new Map<string, (typeof offices)[number]>()
  for (const o of offices) if (!officeByWorkspace.has(o.workspaceId)) officeByWorkspace.set(o.workspaceId, o)

  for (const [workspaceId, office] of officeByWorkspace) {
    if (!isWorkdayForAttendanceDate(today, office)) continue
    if (await isHoliday(workspaceId, today)) continue // tanggal merah → no live accrual

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, role: { notIn: ["BOD", "ONE_ABOVE_ALL"] } },
      select: { userId: true },
    })

    for (const member of members) {
      const userId = member.userId

      // Already checked in/out → penalty is finalized at check-in; don't touch.
      const record = await prisma.attendanceRecord.findUnique({
        where: { userId_workspaceId_attendanceDate: { userId, workspaceId, attendanceDate: today } },
        select: { checkInAt: true, checkOutAt: true },
      })
      if (record?.checkInAt || record?.checkOutAt) continue

      // Covered by leave/day-off → not late. If a late penalty already accrued before the
      // day-off was filed, refund it (so filing a day-off retroactively clears the penalty).
      const covering = await prisma.attendanceRequest.findFirst({
        where: { userId, workspaceId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: today }, endDate: { gte: today } },
        select: { id: true },
      })
      if (covering) {
        await clearLatePenalty(userId, dateKey)
        continue
      }

      // BoD pardoned today for this member → no live accrual either.
      if (await hasAttendanceWaiver(userId, dateKey)) continue

      const shift = await resolveEffectiveAttendanceShift({ userId, workspaceId, office, date: today })
      // Only accrue for users whose shift is EXPLICIT and unambiguous: a per-person override
      // ("USER", set in Control Room → Members) or a team override ("TEAM"). Office-default
      // shift is ambiguous before check-in (workspace has multiple offices with different
      // shifts, and the real office is only known at check-in via geofence) → skip those here;
      // they get penalized accurately at check-in instead.
      if (shift.source !== "USER" && shift.source !== "TEAM") continue
      // Flexi members aren't "late" until the window END (15:00); accrue against that, not the 12:00 start.
      const lateBaseline = shift.flexi ? FLEXI_WINDOW_END : shift.shiftStartTime
      const elapsed = minutesLateAgainstShift(now, today, lateBaseline, safeAttendanceTimezone(office.timezone))
      if (elapsed <= 0) continue // shift not started / not late yet

      // Respect the late grace window: someone still within grace is NOT late yet (check-in would
      // count them ON_TIME), so don't accrue a penalty. Without this, the cron nicked XP from
      // minute 1 even though the policy allows `graceMinutes` of slack → wrongful penalties for
      // people who check in a few minutes late but within grace.
      const grace = Math.max(0, office.lateGraceMinutes ?? 0)
      if (elapsed <= grace) continue // within grace → not late yet, no penalty

      const target = -Math.min(elapsed, 120)
      await setLatePenalty(userId, dateKey, target)
      result.accrued++
      result.totalPenaltyXp += target
    }
  }

  return result
}
